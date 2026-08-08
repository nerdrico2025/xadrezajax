// ─────────────────────────────────────────────────────────────────────────────
// A matemática da análise pós-jogo — funções PURAS, sem engine e sem rede.
//
// Está num módulo só e sem efeito colateral de propósito: é aqui que mora o
// julgamento sobre a partida do usuário ("isto foi um erro", "foi aqui que você
// perdeu"), e julgamento errado é pior que ausência de julgamento. Tudo o que
// está aqui é testável sem o binário do Stockfish.
//
// Ver docs/execution/PLANO_FASE2_ANALISE_POS_JOGO.md §4.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Teto de avaliação, em centipawns, aplicado ANTES de qualquer conta.
 *
 * O motivo é concreto: mate vira ±10000 na escala do UCI, então deixar passar
 * um mate em 5 viraria uma "perda" de vinte mil centipawns e arrastaria a média
 * da partida inteira junto. Acima de dez peões de vantagem a diferença entre
 * "ganho" e "ganho demais" também não é informação para quem está aprendendo.
 *
 * Truncado, deixar o mate escapar continua sendo um erro grande — grande como
 * um blunder, não como um evento fora de escala.
 */
const EVAL_CLAMP_CP = 1000;

/** Score de mate na escala do UCI, antes do truncamento. */
const MATE_CP = 10000;

/**
 * Faixas de classificação por perda em centipawns (com truncamento aplicado).
 * O corte de blunder em 300cp é o mesmo `BIG_BLUNDER_CP` que o
 * validate-cp-loss.js já usa como limiar de erro grave — a régua da análise e a
 * régua da calibragem da IA são a MESMA, e se uma mudar a outra deveria mudar
 * junto.
 */
const BEST_MAX_LOSS = 10;
const GOOD_MAX_LOSS = 50;
const INACCURACY_MAX_LOSS = 100;
const MISTAKE_MAX_LOSS = 300;

/** "Brilhante" precisa das duas condições — ver `classifyMove`. */
const ONLY_MOVE_MARGIN_CP = 200;
const SACRIFICE_MIN_PAWNS = 1.5;

/** Lances iniciais tratados como teoria de abertura. Entram na lista exibida,
 *  mas ficam FORA da média de precisão: contá-los faz todo mundo parecer mais
 *  preciso do que é, e infla mais quem decora abertura. */
const BOOK_PLIES = 12;

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Trunca uma avaliação em ±EVAL_CLAMP_CP. */
function clampEval(cp) {
  if (!Number.isFinite(cp)) return 0;
  return Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, cp));
}

/**
 * Converte uma linha do MultiPV em centipawns comparáveis, já truncados.
 * `mate` positivo = mate a favor de quem está para jogar.
 */
function lineToCp(line) {
  if (!line) return null;
  if (line.mate !== null && line.mate !== undefined) {
    return clampEval(line.mate > 0 ? MATE_CP : -MATE_CP);
  }
  if (line.cp === null || line.cp === undefined) return null;
  return clampEval(line.cp);
}

/**
 * Perda do lance jogado na posição i.
 *
 *   cp_loss = eval(P_i) − ( −eval(P_{i+1}) )
 *
 * As duas avaliações vêm do ponto de vista de QUEM ESTÁ PARA JOGAR na
 * respectiva posição, e é por isso que a segunda entra invertida: em P_{i+1}
 * quem está para jogar é o adversário.
 *
 * Nunca negativa: ruído da engine pode fazer o lance jogado "avaliar melhor"
 * que a busca anterior, e isso não é ganho — é margem de erro.
 */
function centipawnLoss(evalBefore, evalAfterOpponentView) {
  const before = clampEval(evalBefore);
  const afterMoverView = -clampEval(evalAfterOpponentView);
  return Math.max(0, Math.round(before - afterMoverView));
}

/**
 * Probabilidade de vitória (0–100) de quem está para jogar, a partir da
 * avaliação em centipawns. Curva logística do Lichess.
 *
 * Existe porque centipawn não é linear: perder 300cp em posição igual decide a
 * partida; perder 300cp estando 900 à frente não muda nada. Comparar quedas na
 * escala de cp apontaria o "momento decisivo" errado.
 */
function winProbability(cp) {
  const clamped = clampEval(cp);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/**
 * Precisão (0–100) de UM lance, a partir de quanto ele custou em probabilidade
 * de vitória. Fórmula do Lichess.
 *
 * Deriva da probabilidade, e não do cp direto, pela mesma razão acima: um erro
 * de 200cp numa posição já perdida quase não muda a chance de ganhar, e a nota
 * do lance deve refletir isso.
 */
function moveAccuracy(winPercentBefore, winPercentAfter) {
  const drop = Math.max(0, winPercentBefore - winPercentAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Saldo de material de um lado, em peões, a partir de um `board()` do chess.js.
 * Rei não entra (está sempre nos dois lados).
 */
function materialBalance(board, color) {
  let mine = 0;
  let theirs = 0;
  for (const row of board) {
    for (const square of row) {
      if (!square) continue;
      const value = PIECE_VALUE[square.type] ?? 0;
      if (square.color === color) mine += value;
      else theirs += value;
    }
  }
  return mine - theirs;
}

/**
 * Classifica um lance.
 *
 * "Brilhante" NÃO sai de cp_loss: por perda de centipawns, um lance brilhante é
 * indistinguível de um óbvio — os dois perdem zero. O que separa os dois é o
 * contexto, e por isso são exigidas as duas condições:
 *
 *   - lance ÚNICO   — a segunda linha do MultiPV perde ≥200cp para a primeira,
 *                     ou seja, quase tudo o mais estragava a posição;
 *   - SACRIFÍCIO    — o lance entrega ≥1,5 peão de saldo e mesmo assim mantém
 *                     a avaliação.
 *
 * Exigir as duas deixa a etiqueta rara, que é o ponto: uma etiqueta que aparece
 * toda hora não significa nada.
 */
function classifyMove({ cpLoss, isOnlyMove, sacrificedPawns }) {
  if (cpLoss <= BEST_MAX_LOSS) {
    const sacrificed = (sacrificedPawns ?? 0) >= SACRIFICE_MIN_PAWNS;
    if (isOnlyMove && sacrificed) return "brilliant";
    return "best";
  }
  if (cpLoss <= GOOD_MAX_LOSS) return "good";
  if (cpLoss <= INACCURACY_MAX_LOSS) return "inaccuracy";
  if (cpLoss <= MISTAKE_MAX_LOSS) return "mistake";
  return "blunder";
}

/**
 * "Lance único": a alternativa imediata era muito pior. Sem segunda linha
 * (posição com um lance legal só) NÃO conta — lance forçado é o contrário de
 * uma descoberta.
 */
function isOnlyMove(bestCp, secondCp) {
  if (bestCp === null || secondCp === null) return false;
  return bestCp - secondCp >= ONLY_MOVE_MARGIN_CP;
}

/**
 * Lance tratado como teoria de abertura — e portanto fora da média de precisão.
 *
 * Ser cedo NÃO BASTA. A justificativa de excluir abertura é que os primeiros
 * lances costumam ser decorados, com perda quase zero, e contá-los infla a
 * precisão de todo mundo. Um erro grosseiro no ply 6 não é nada disso: é um
 * lance de verdade, do jogador, e tem de entrar na conta.
 *
 * Sem esta segunda condição, um mate do pastor (o erro decisivo cai no ply 6)
 * era classificado como blunder na lista E excluído da média — a vítima
 * terminava a partida sem precisão nenhuma para mostrar. Foi exatamente o que
 * apareceu no primeiro teste contra a engine real.
 */
function isBookMove(ply, cpLoss) {
  return ply <= BOOK_PLIES && cpLoss <= GOOD_MAX_LOSS;
}

/**
 * O momento em que a partida virou.
 *
 * `moves` são as entradas já classificadas, cada uma com `ply`, `color`
 * ("w"/"b"), `winBefore` e `winAfter` — as duas do ponto de vista de QUEM
 * JOGOU o lance.
 *
 * Regras, nesta ordem:
 *   1. só lances de quem PERDEU (num empate, os dois lados — os dois deixaram
 *      escapar);
 *   2. entre eles, a maior queda de probabilidade de vitória num lance só;
 *   3. e apenas se o lance CRUZOU A FRONTEIRA: de ganhando/igual (≥50%) para
 *      perdendo (<50%). Cair de 95% para 80% é uma queda grande em número e não
 *      decidiu nada.
 *
 * Devolve null quando não existe esse momento — partida ganha do começo ao fim,
 * ou derrota construída em dez imprecisões sem nenhum lance culpado. NULO É
 * RESULTADO LEGÍTIMO: apontar um "erro decisivo" numa partida que não teve um é
 * pior do que não apontar nada.
 */
function findTurningPoint(moves, result) {
  const losers =
    result === "white" ? ["b"] : result === "black" ? ["w"] : ["w", "b"];

  let best = null;
  for (const move of moves) {
    if (!losers.includes(move.color)) continue;
    if (move.winBefore < 50 || move.winAfter >= 50) continue; // não cruzou
    const drop = move.winBefore - move.winAfter;
    if (best === null || drop > best.drop) best = { ply: move.ply, drop };
  }
  return best ? best.ply : null;
}

module.exports = {
  EVAL_CLAMP_CP,
  MATE_CP,
  BEST_MAX_LOSS,
  GOOD_MAX_LOSS,
  INACCURACY_MAX_LOSS,
  MISTAKE_MAX_LOSS,
  ONLY_MOVE_MARGIN_CP,
  SACRIFICE_MIN_PAWNS,
  BOOK_PLIES,
  PIECE_VALUE,
  clampEval,
  lineToCp,
  centipawnLoss,
  winProbability,
  moveAccuracy,
  materialBalance,
  classifyMove,
  isOnlyMove,
  isBookMove,
  findTurningPoint,
};
