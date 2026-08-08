const { Chess } = require("chess.js");
const { EnginePool } = require("./enginePool");
const { parseMultipvLine, poolStats } = require("./stockfish.service");
const {
  BOOK_PLIES,
  EVAL_CLAMP_CP,
  centipawnLoss,
  classifyMove,
  clampEval,
  findTurningPoint,
  isBookMove,
  isOnlyMove,
  lineToCp,
  materialBalance,
  moveAccuracy,
  winProbability,
} = require("./analysisMath");

// ─────────────────────────────────────────────────────────────────────────────
// Análise pós-jogo — a partida já acabou, e aqui se descobre o que aconteceu
// nela. Ver docs/execution/PLANO_FASE2_ANALISE_POS_JOGO.md §2.
//
// POOL SEPARADO, e não uma fila com prioridade dentro do pool ao vivo:
// prioridade dentro de um pool só significaria uma análise já em curso
// segurando o engine que um lance de partida ao vivo precisa. Instância própria
// garante que o pool ao vivo NUNCA perde um slot para análise.
//
// Isso resolve a disputa por SLOT. A disputa por CPU FÍSICA continua — é a
// mesma VPS — e para ela existe o recuo cooperativo: antes de cada busca,
// olhar se há alguém esperando engine numa partida ao vivo e, se houver, sair
// da frente. Não é preempção de verdade, mas usa dado real (a telemetria da
// PR #101) em vez de palpite.
// ─────────────────────────────────────────────────────────────────────────────

/** Um engine só. Análise é trabalho de fundo: fazer duas ao mesmo tempo dobra a
 *  pressão de CPU sobre as partidas ao vivo sem entregar nada mais rápido para
 *  o usuário, que já está olhando "analisando…". */
const ANALYSIS_POOL_SIZE = 1;

/** A fila de análise é curta de propósito: o trabalho vem UM por vez do Django
 *  (ver analysisQueue.js), então uma fila grande aqui só esconderia bug. */
const ANALYSIS_MAX_QUEUE = 4;

/** Mesma configuração do nível Mestre já em produção (skill 20, depth 12,
 *  movetime 400 — o `REFERENCE` do validate-cp-loss.js), com duas diferenças:
 *  MultiPV 2, que é o que torna "Brilhante" definível, e Threads explícito. */
const ANALYSIS_CONFIG = {
  skill: 20,
  depth: 12,
  movetime: 400,
  multipv: 2,
  threads: 1,
};

const SEARCH_TIMEOUT_MS = ANALYSIS_CONFIG.movetime + 4000;

/** Quanto esperar antes de checar de novo se as partidas ao vivo liberaram a
 *  engine. Curto o bastante para a análise não parar à toa. */
const BACKOFF_MS = 250;

/** Teto de esperas seguidas antes de seguir assim mesmo. Sem ele, um pool ao
 *  vivo permanentemente ocupado deixaria a análise parada para sempre e o
 *  aluguel venceria — a partida voltaria para a fila e o ciclo se repetiria. */
const MAX_BACKOFF_ROUNDS = 40; // ~10s

const pool = new EnginePool({
  size: ANALYSIS_POOL_SIZE,
  maxQueue: ANALYSIS_MAX_QUEUE,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Erro de partida impossível de analisar (lance ilegal, payload corrompido).
 *  É TERMINAL: tentar de novo não melhora o dado. */
class UnanalyzableGameError extends Error {
  constructor(message) {
    super(message);
    this.terminal = true;
  }
}

/**
 * Refaz a partida a partir dos SAN e devolve uma posição por lance.
 *
 * É aqui que a validação de legalidade acontece — o Django não tem biblioteca
 * de xadrez, então uma partida vs IA forjada ou corrompida (os lances vêm do
 * app, sem passar pelo servidor) só é detectada neste ponto. Lance ilegal vira
 * erro terminal, com o ply no motivo.
 */
function replay(moves, initialFen) {
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const positions = [];

  moves.forEach((san, index) => {
    const ply = index + 1;
    const fenBefore = chess.fen();
    const color = chess.turn();
    const boardBefore = chess.board();

    let move;
    try {
      move = chess.move(san);
    } catch {
      move = null;
    }
    if (!move) {
      throw new UnanalyzableGameError(
        `Lance ilegal no ply ${ply}: "${san}"`
      );
    }

    positions.push({
      ply,
      san: move.san,
      color,
      fenBefore,
      fenAfter: chess.fen(),
      boardBefore,
      boardAfter: chess.board(),
      isGameOver: chess.isGameOver(),
      isCheckmate: chess.isCheckmate(),
    });
  });

  return positions;
}

/**
 * Espera as partidas ao vivo liberarem CPU antes de gastar engine com análise.
 * Devolve quantas rodadas esperou (0 = seguiu direto).
 */
async function waitForLiveIdle(stats = poolStats) {
  let rounds = 0;
  while (rounds < MAX_BACKOFF_ROUNDS) {
    let waiting;
    try {
      waiting = stats().waiting ?? 0;
    } catch {
      // Telemetria indisponível não pode travar a análise.
      return rounds;
    }
    if (waiting === 0) return rounds;
    rounds += 1;
    await sleep(BACKOFF_MS);
  }
  console.warn(
    "[Analysis] pool ao vivo ocupado por muito tempo — seguindo assim mesmo"
  );
  return rounds;
}

/** Avalia UMA posição. Devolve `{ cp, secondCp, bestMoveUci }`. */
async function evaluatePosition(engine, fen, { newGame }) {
  const { pvLines } = await engine.search({
    skill: ANALYSIS_CONFIG.skill,
    multipv: ANALYSIS_CONFIG.multipv,
    threads: ANALYSIS_CONFIG.threads,
    fen,
    goCmd: `go depth ${ANALYSIS_CONFIG.depth} movetime ${ANALYSIS_CONFIG.movetime}\n`,
    timeoutMs: SEARCH_TIMEOUT_MS,
    parseLine: parseMultipvLine,
    newGame,
  });

  return {
    cp: lineToCp(pvLines[1]),
    secondCp: lineToCp(pvLines[2]),
    bestMoveUci: pvLines[1]?.move ?? null,
  };
}

/** Converte um lance UCI em SAN na posição dada. Devolve "" se não der. */
function uciToSan(fen, uci) {
  if (!uci) return "";
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move ? move.san : "";
  } catch {
    return "";
  }
}

/**
 * Analisa uma partida inteira e devolve o payload que o Django espera.
 *
 * UMA avaliação por POSIÇÃO, não três por lance: os lances já foram jogados, e
 * a perda de cada um sai da diferença entre avaliações consecutivas. Uma
 * partida de N lances custa N+1 buscas em vez de 3N — é o que faz a coisa
 * caber numa VPS pequena.
 */
async function analyzeGame({
  moves,
  initialFen,
  result,
  maxPlies,
  onProgress = null,
}) {
  if (!Array.isArray(moves) || moves.length === 0) {
    throw new UnanalyzableGameError("Partida sem lances.");
  }

  const limit = Number(maxPlies) > 0 ? Number(maxPlies) : moves.length;
  const truncated = moves.slice(0, limit);
  const positions = replay(truncated, initialFen);

  const engine = await pool.acquire();
  let healthy = true;
  try {
    // `ucinewgame` UMA vez por partida: as posições se sucedem, então a hash
    // sobrevivendo entre elas acelera sem distorcer nada. É o oposto da
    // disciplina do pool ao vivo, onde a hash entre lances falsearia a
    // calibragem de força.
    let first = true;

    const evaluations = [];
    for (const position of positions) {
      await waitForLiveIdle();
      evaluations.push(
        await evaluatePosition(engine, position.fenBefore, { newGame: first })
      );
      first = false;
      onProgress?.(evaluations.length, positions.length);
      // Cede o event loop entre posições: é o que permite a análise PAUSAR
      // quando chega gente jogando, em vez de disputar CPU até o fim.
      await sleep(0);
    }

    // Avaliação da posição FINAL — a que fecha o cp_loss do último lance.
    const last = positions[positions.length - 1];
    let finalEval;
    if (last.isGameOver) {
      // Posição terminal não tem busca: quem está para jogar levou o mate,
      // então a avaliação é o teto NEGATIVO do ponto de vista dele. Qualquer
      // outro fim (afogamento, repetição, material insuficiente) é 0.
      finalEval = { cp: last.isCheckmate ? -EVAL_CLAMP_CP : 0 };
    } else {
      await waitForLiveIdle();
      finalEval = await evaluatePosition(engine, last.fenAfter, {
        newGame: false,
      });
    }
    evaluations.push(finalEval);

    return buildReport({ positions, evaluations, result, moves });
  } catch (err) {
    healthy = false;
    pool.discard(engine);
    throw err;
  } finally {
    if (healthy) pool.release(engine);
  }
}

/** Monta o relatório final a partir das posições e das avaliações. */
function buildReport({ positions, evaluations, result, moves }) {
  const analyzed = [];
  const accuracies = { w: [], b: [] };
  const losses = { w: [], b: [] };
  const counts = {
    white: emptyCounts(),
    black: emptyCounts(),
  };

  positions.forEach((position, index) => {
    const before = evaluations[index];
    const after = evaluations[index + 1];
    const evalBefore = before.cp ?? 0;
    const evalAfterOpponentView = after.cp ?? 0;

    const cpLoss = centipawnLoss(evalBefore, evalAfterOpponentView);

    // Material entregue: comparado com a posição APÓS a resposta do
    // adversário — é aí que um sacrifício de verdade aparece no tabuleiro.
    const nextPosition = positions[index + 1];
    const balanceBefore = materialBalance(position.boardBefore, position.color);
    const balanceLater = nextPosition
      ? materialBalance(nextPosition.boardAfter, position.color)
      : balanceBefore;
    const sacrificedPawns = balanceBefore - balanceLater;

    const onlyMove = isOnlyMove(before.cp, before.secondCp);
    const classification = classifyMove({
      cpLoss,
      isOnlyMove: onlyMove,
      sacrificedPawns,
    });

    // Probabilidade sempre do ponto de vista de QUEM JOGOU o lance.
    const winBefore = winProbability(evalBefore);
    const winAfter = 100 - winProbability(evalAfterOpponentView);

    const book = isBookMove(position.ply, cpLoss);
    const side = position.color;
    if (!book) {
      accuracies[side].push(moveAccuracy(winBefore, winAfter));
      losses[side].push(cpLoss);
    }
    const bucket = side === "w" ? counts.white : counts.black;
    bucket[classification] += 1;

    analyzed.push({
      ply: position.ply,
      san: position.san,
      color: side,
      eval_cp: clampEval(evalBefore),
      cp_loss: cpLoss,
      classification,
      best_move_san: uciToSan(position.fenBefore, before.bestMoveUci),
      is_only_move: onlyMove,
      is_book: book,
      winBefore,
      winAfter,
    });
  });

  const turningPoint = findTurningPoint(analyzed, result);

  return {
    // `winBefore`/`winAfter`/`color` são de uso interno (momento decisivo e
    // separação por cor) e não vão para o banco — o Django descarta campo
    // desconhecido, mas mandar lixo seria sujeira de contrato.
    moves: analyzed.map(({ winBefore: _wb, winAfter: _wa, color: _c, ...rest }) => rest),
    counts,
    white_accuracy: mean(accuracies.w),
    black_accuracy: mean(accuracies.b),
    white_avg_loss: meanInt(losses.w),
    black_avg_loss: meanInt(losses.b),
    turning_point_ply: turningPoint,
    analyzed_plies: analyzed.length,
    total_plies: moves.length,
    engine_depth: ANALYSIS_CONFIG.depth,
    engine_movetime: ANALYSIS_CONFIG.movetime,
  };
}

function emptyCounts() {
  return {
    brilliant: 0,
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
}

function mean(values) {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function meanInt(values) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

module.exports = {
  analyzeGame,
  replay,
  buildReport,
  waitForLiveIdle,
  UnanalyzableGameError,
  ANALYSIS_CONFIG,
  ANALYSIS_POOL_SIZE,
  BOOK_PLIES,
  analysisPoolStats: () => pool.stats(),
  shutdownAnalysisPool: () => pool.shutdown(),
};
