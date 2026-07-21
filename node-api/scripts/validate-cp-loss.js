/**
 * Validação de força HUMANA da IA por perda de centipawns (rodada de UX
 * pós-Campanha, item 2).
 *
 * POR QUE ESTE SCRIPT EXISTE, já havendo o validate-ai-strength.js: aquele roda
 * bot contra bot e só prova que os níveis diferem ENTRE SI — continuaria
 * passando com uma curva em que o "Iniciante" joga como 1900 Elo (foi
 * exatamente o que aconteceu duas vezes). Este mede a única coisa que
 * corresponde a força humana: quanto a IA entrega por lance.
 *
 * MÉTODO (o mesmo do Lichess): para cada posição, aplica o lance escolhido pelo
 * nível e avalia a posição resultante com Stockfish forte (referência de
 * verdade), comparando com a avaliação após o melhor lance. A diferença é a
 * perda em centipawns daquele lance. Medir só o ranking do MultiPV não serve:
 * enviesa para baixo, porque descarta justamente os lances tão ruins que nem
 * aparecem no top-N.
 *
 * RÉGUA (literatura pública de análise de partidas, perda média por lance):
 *   <20cp ≈ 2000+ Elo · 20-40cp ≈ 1700-2000 · 40-60cp ≈ 1400-1700
 *   60-90cp ≈ 1100-1400 · 90-150cp ≈ 800-1100 · >150cp ≈ <800
 *
 * Uso:  node scripts/validate-cp-loss.js [amostrasPorPosicao]
 * Requer o binário `stockfish` no PATH (o CI não o instala — por isso este
 * arquivo é um script sob demanda, não um teste do Jest).
 */
const { spawn } = require("child_process");
const { Chess } = require("chess.js");
const {
  LEVELS,
  ERROR_WINDOWS,
  LEVEL_ORDER,
  pickMove,
  parseMultipvLine,
} = require("../src/services/stockfish.service");

const SAMPLES = Number(process.argv[2] || 6);

// Referência de verdade: forte o bastante para julgar os lances dos níveis.
const REFERENCE = { skill: 20, depth: 12, movetime: 400, multipv: 1 };

// Faixas aceitas por nível (cp de perda média por lance). Derivadas da curva
// medida na proposta aprovada; ajuste junto com ERROR_WINDOWS se a curva mudar.
const EXPECTED_RANGES = {
  beginner: { min: 100, max: 200 },
  easy: { min: 60, max: 110 },
  medium: { min: 15, max: 50 },
  hard: { min: 0, max: 20 },
  master: { min: 0, max: 10 },
};

// Limites de segurança do comportamento (anti-catástrofe), válidos para
// TODOS os níveis: a IA pode errar, nunca se suicidar.
const MAX_SHARE_BIG_BLUNDERS = 0.15; // ≤15% dos lances podem perder ≥300cp
const BIG_BLUNDER_CP = 300;

// Posições de teste: abertura, meio-jogo tático, meio-jogo posicional e final.
const POSITIONS = [
  ["abertura aberta", "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"],
  ["tática: dama em h5", "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3"],
  ["italiana desenvolvida", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5"],
  ["peça sob ataque", "r1bqkb1r/pppp1ppp/5n2/4n3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 5"],
  ["siciliana", "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"],
  ["meio-jogo fechado", "r2q1rk1/ppp2ppp/2np1n2/2b1p1B1/2B1P1b1/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 9"],
];

const MATE_CP = 10000;

function analyse(fen, { skill, depth, movetime, multipv }) {
  return new Promise((resolve, reject) => {
    const engine = spawn("stockfish");
    const lines = {};
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        engine.kill();
        reject(new Error("Stockfish timeout"));
      }
    }, (movetime || depth * 1000) + 10000);

    engine.stdout.on("data", (data) => {
      for (const raw of data.toString().split("\n")) {
        if (raw.startsWith("info") && raw.includes("multipv")) {
          const parsed = parseMultipvLine(raw);
          if (parsed) lines[parsed.index] = parsed;
        }
        if (raw.startsWith("bestmove") && !done) {
          done = true;
          clearTimeout(timer);
          engine.kill();
          resolve({ lines, best: raw.split(" ")[1] });
          return;
        }
      }
    });
    engine.on("error", reject);

    engine.stdin.write("uci\n");
    engine.stdin.write(`setoption name Skill Level value ${skill}\n`);
    if (multipv > 1) engine.stdin.write(`setoption name MultiPV value ${multipv}\n`);
    engine.stdin.write("isready\n");
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(
      movetime ? `go depth ${depth} movetime ${movetime}\n` : `go depth ${depth}\n`
    );
  });
}

function scoreOf(line) {
  if (!line) return null;
  if (line.mate !== null && line.mate !== undefined) {
    return line.mate > 0 ? MATE_CP : -MATE_CP;
  }
  return line.cp ?? null;
}

/** Avalia a posição APÓS o lance, do ponto de vista de quem acabou de jogar. */
async function evalAfterMove(fen, uci) {
  const game = new Chess(fen);
  const move = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
  try {
    if (!game.move(move)) return null;
  } catch {
    return null;
  }
  if (game.isGameOver()) {
    if (game.isCheckmate()) return MATE_CP; // deu mate: ótimo para quem jogou
    return 0; // empate
  }
  const { lines } = await analyse(game.fen(), REFERENCE);
  const score = scoreOf(lines[1]);
  // O score vem do ponto de vista do lado a mover (o adversário) — inverte.
  return score === null ? null : -score;
}

/** Mede a perda média de centipawns de um nível sobre o conjunto de posições. */
async function measureLevel(level) {
  const config = LEVELS[level];
  const errorWindow = ERROR_WINDOWS[level] ?? null;
  const losses = [];
  let mateBlunders = 0;

  for (const [, fen] of POSITIONS) {
    const reference = await analyse(fen, REFERENCE);
    const baseline = await evalAfterMove(fen, reference.best);
    if (baseline === null) continue;

    const run = await analyse(fen, config);
    for (let i = 0; i < SAMPLES; i++) {
      const move = pickMove(run.best, run.lines, errorWindow);
      const after = await evalAfterMove(fen, move);
      if (after === null) continue;
      // Perda: quanto pior que o melhor lance possível naquela posição.
      const loss = Math.max(0, baseline - after);
      losses.push(loss);
      // Entregou mate ao adversário = catástrofe que o filtro deve impedir.
      if (after <= -MATE_CP) mateBlunders += 1;
    }
  }

  const average = Math.round(losses.reduce((a, b) => a + b, 0) / losses.length);
  const bigBlunders = losses.filter((l) => l >= BIG_BLUNDER_CP).length;
  return {
    level,
    average,
    samples: losses.length,
    bigBlunders,
    bigBlunderShare: bigBlunders / losses.length,
    mateBlunders,
  };
}

(async () => {
  console.log("Validação de força humana por perda de centipawns");
  console.log(`Amostras por posição: ${SAMPLES} · Posições: ${POSITIONS.length}`);
  console.log(`Referência: Stockfish depth ${REFERENCE.depth}\n`);

  const results = [];
  for (const level of LEVEL_ORDER) {
    process.stdout.write(`  medindo ${level}...`);
    results.push(await measureLevel(level));
    process.stdout.write(" ok\n");
  }

  console.log("\n=== PERDA MÉDIA POR LANCE ===");
  let ok = true;

  for (const r of results) {
    const range = EXPECTED_RANGES[r.level];
    const inRange = r.average >= range.min && r.average <= range.max;
    const noMate = r.mateBlunders === 0;
    const blundersOk = r.bigBlunderShare <= MAX_SHARE_BIG_BLUNDERS;
    const pass = inRange && noMate && blundersOk;
    ok = ok && pass;

    console.log(
      `${pass ? "PASS" : "FAIL"}  ${r.level.padEnd(9)} ` +
        `${String(r.average).padStart(4)}cp ` +
        `(esperado ${range.min}-${range.max}cp) · ` +
        `erros≥${BIG_BLUNDER_CP}cp: ${r.bigBlunders}/${r.samples} ` +
        `(${(r.bigBlunderShare * 100).toFixed(0)}%) · mates entregues: ${r.mateBlunders}`
    );
    if (!inRange) console.log(`      ↳ fora da faixa esperada de força`);
    if (!noMate) console.log(`      ↳ CATÁSTROFE: entregou mate ${r.mateBlunders}x`);
    if (!blundersOk)
      console.log(
        `      ↳ erros grandes acima do teto de ${MAX_SHARE_BIG_BLUNDERS * 100}%`
      );
  }

  // Monotonicidade: a perda tem de decrescer do Iniciante ao Mestre — se
  // inverter, a progressão de dificuldade quebrou.
  console.log("\n=== MONOTONICIDADE (perda deve decrescer) ===");
  const sequence = results.map((r) => `${r.level}=${r.average}cp`).join(" > ");
  let monotonic = true;
  for (let i = 1; i < results.length; i++) {
    if (results[i].average > results[i - 1].average) monotonic = false;
  }
  ok = ok && monotonic;
  console.log(`${monotonic ? "PASS" : "FAIL"}  ${sequence}`);

  console.log(`\n${ok ? "✅ Curva validada" : "❌ Curva fora do esperado"}`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
