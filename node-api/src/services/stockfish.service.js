const { spawn } = require("child_process");

// Calibragem de força da IA (PR C, item 7).
//
// O engine é o Stockfish real (UCI). Só `go depth N` NÃO produz níveis fáceis
// convincentes: mesmo a depth 2 o Stockfish acha lances tática/estrategicamente
// fortes. Por isso combinamos três limites por nível:
//   - Skill Level (0–20): introduz imprecisão/erros deliberados (é o que de fato
//     enfraquece o jogo no low-end);
//   - depth: teto de profundidade de busca;
//   - movetime: teto de tempo de análise (ms).
//
// UCI_LimitStrength + UCI_Elo NÃO é usado porque o piso de UCI_Elo do Stockfish
// (~1320) não expressa os níveis Iniciante (~800) e Fácil (~1100). Skill Level
// é o mecanismo uniforme que alcança os cinco níveis.
//
// A coluna `elo` é só o alvo aproximado exibido na UI ("Fácil · ~1100").
const LEVELS = {
  beginner: { skill: 0, depth: 1, movetime: 150, elo: 800 },
  easy: { skill: 2, depth: 2, movetime: 250, elo: 1100 },
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

function getBestMove(fen, level = DEFAULT_LEVEL) {
  const { skill, depth, movetime } = resolveLevel(level);
  // Janela de timeout: tempo de análise + folga para spawn/handshake.
  const timeoutMs = (movetime || depth * 1000) + 5000;
  const goCmd = movetime
    ? `go depth ${depth} movetime ${movetime}\n`
    : `go depth ${depth}\n`;

  return new Promise((resolve, reject) => {
    const engine = spawn("stockfish");

    let responded = false;

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
        if (line.startsWith("bestmove") && !responded) {
          responded = true;
          clearTimeout(timeout);

          const bestMove = line.split(" ")[1];
          engine.kill();
          resolve(bestMove || null);
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
    engine.stdin.write("isready\n");
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(goCmd);
  });
}

module.exports = { getBestMove, LEVELS, DEFAULT_LEVEL };
