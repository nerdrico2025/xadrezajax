const { spawn } = require("child_process");

// Calibragem de força da IA (PR C, item 7; enfraquecida na Rodada 2, item 3).
//
// O engine é o Stockfish real (UCI). Só `go depth N` NÃO produz níveis fáceis
// convincentes: mesmo a depth 2 o Stockfish acha lances tática/estrategicamente
// fortes. Por isso combinamos quatro limites por nível:
//   - Skill Level (0–20): introduz imprecisão/erros deliberados (é o que de fato
//     enfraquece o jogo no low-end);
//   - depth: teto de profundidade de busca;
//   - movetime: teto de tempo de análise (ms);
//   - multipv/subOptimalChance (só Iniciante/Fácil): Skill 0 + depth 1 já é o
//     piso desses dois eixos — não dá pra descer mais. Para enfraquecer ainda
//     mais SEM lances absurdos (dar a dama de graça), pedimos ao Stockfish as
//     N melhores linhas (MultiPV) e, com a probabilidade configurada, jogamos
//     uma das linhas inferiores em vez da melhor. Continuam sendo lances que
//     o próprio engine avaliou como razoáveis — só não os ótimos.
//
// UCI_LimitStrength + UCI_Elo NÃO é usado porque o piso de UCI_Elo do Stockfish
// (~1320) não expressa os níveis Iniciante (~800) e Fácil (~1100). Skill Level
// é o mecanismo uniforme que alcança os cinco níveis.
//
// A coluna `elo` é só o alvo aproximado exibido na UI ("Fácil · ~1100").
const LEVELS = {
  beginner: {
    skill: 0,
    depth: 1,
    movetime: 150,
    elo: 800,
    multipv: 4,
    subOptimalChance: 0.55,
  },
  easy: {
    skill: 2,
    depth: 2,
    movetime: 250,
    elo: 1100,
    multipv: 3,
    subOptimalChance: 0.25,
  },
  medium: { skill: 5, depth: 4, movetime: 400, elo: 1400 },
  hard: { skill: 10, depth: 8, movetime: 700, elo: 1700 },
  master: { skill: 16, depth: 12, movetime: 1200, elo: 2000 },
};

const DEFAULT_LEVEL = "medium";

/**
 * Resolve o parâmetro de dificuldade em limites de engine.
 * Aceita: chave de nível ("beginner".."master"), número (depth legado, força
 * máxima) ou undefined (→ nível padrão).
 */
function resolveLevel(level) {
  if (typeof level === "string" && LEVELS[level]) return LEVELS[level];
  if (typeof level === "number") {
    // Compatibilidade com o contrato antigo (depth puro, sem cap de skill/tempo).
    const depth = Math.max(1, Math.min(level, 20));
    return { skill: 20, depth, movetime: 0 };
  }
  return LEVELS[DEFAULT_LEVEL];
}

// Extrai { index, move } de uma linha "info ... multipv N ... pv <lance> ...".
// Ignorado se a linha não tiver os dois campos (ex.: info sem multipv).
function parseMultipvLine(line) {
  const multipvMatch = line.match(/\bmultipv (\d+)\b/);
  const pvMatch = line.match(/\bpv (\S+)/);
  if (!multipvMatch || !pvMatch) return null;
  return { index: Number(multipvMatch[1]), move: pvMatch[1] };
}

// Sorteia, com a probabilidade configurada, uma das linhas inferiores do
// MultiPV em vez da melhor (índice 1) — lance pior mas plausível, nunca um
// lance ilegal/absurdo aleatório (decisão de produto do item 3 da Rodada 2).
function pickMove(bestMove, pvLines, subOptimalChance) {
  if (!subOptimalChance || Math.random() >= subOptimalChance) return bestMove;
  const altMoves = Object.keys(pvLines)
    .filter((index) => Number(index) !== 1)
    .map((index) => pvLines[index]);
  if (altMoves.length === 0) return bestMove;
  return altMoves[Math.floor(Math.random() * altMoves.length)];
}

function getBestMove(fen, level = DEFAULT_LEVEL) {
  const {
    skill,
    depth,
    movetime,
    multipv = 1,
    subOptimalChance = 0,
  } = resolveLevel(level);
  // Janela de timeout: tempo de análise + folga para spawn/handshake.
  const timeoutMs = (movetime || depth * 1000) + 5000;
  const goCmd = movetime
    ? `go depth ${depth} movetime ${movetime}\n`
    : `go depth ${depth}\n`;

  return new Promise((resolve, reject) => {
    const engine = spawn("stockfish");

    let responded = false;
    // Última linha PV vista por índice MultiPV (1 = melhor); Stockfish
    // reescreve a cada iteração de profundidade, então só a mais recente
    // por índice importa.
    const pvLines = {};

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        engine.kill();
        reject(new Error("Stockfish timeout"));
      }
    }, timeoutMs);

    engine.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");

      for (const line of lines) {
        if (multipv > 1 && line.startsWith("info") && line.includes("multipv")) {
          const parsed = parseMultipvLine(line);
          if (parsed) pvLines[parsed.index] = parsed.move;
        }

        if (line.startsWith("bestmove") && !responded) {
          responded = true;
          clearTimeout(timeout);

          const bestMove = line.split(" ")[1];
          engine.kill();
          resolve(
            bestMove ? pickMove(bestMove, pvLines, subOptimalChance) : null
          );
          return;
        }
      }
    });

    engine.stderr.on("data", (data) => {
      console.error("Stockfish stderr:", data.toString());
    });

    engine.on("error", (err) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        reject(new Error(`Falha ao iniciar Stockfish: ${err.message}`));
      }
    });

    engine.stdin.write("uci\n");
    engine.stdin.write(`setoption name Skill Level value ${skill}\n`);
    if (multipv > 1) {
      engine.stdin.write(`setoption name MultiPV value ${multipv}\n`);
    }
    engine.stdin.write("isready\n");
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(goCmd);
  });
}

module.exports = {
  getBestMove,
  LEVELS,
  DEFAULT_LEVEL,
  // Exportados só para teste unitário isolado (sem depender do binário
  // stockfish real): parsing de linha UCI e escolha subótima.
  parseMultipvLine,
  pickMove,
};
