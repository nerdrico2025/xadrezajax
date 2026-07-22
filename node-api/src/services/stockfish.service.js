const { EnginePool } = require("./enginePool");

// ─────────────────────────────────────────────────────────────────────────────
// Calibragem de força da IA — reescrita na rodada de UX pós-Campanha (item 2).
//
// POR QUE A CALIBRAGEM ANTERIOR FALHOU (3 reclamações seguidas de "Iniciante
// difícil demais"): o Iniciante rodava Skill 0 + depth 1 + MultiPV 4. Medindo a
// perda média de centipawns por lance (método Lichess: aplica o lance, avalia a
// posição resultante contra Stockfish depth 12), o Iniciante entregava só
// ~18cp por lance — força de ~1900/2000 Elo. O mecanismo de "lance subótimo"
// existia, mas em depth 1 as 4 linhas do MultiPV diferem no máximo ~17cp entre
// si: ele sorteava entre quatro lances todos bons. Não havia erro para injetar.
//
// O QUE MUDA: o erro passa a ser escolhido por JANELA DE PERDA, não por
// "índice da linha". Pedimos muitas linhas ao engine (MultiPV alto) e, com a
// probabilidade do nível, jogamos uma linha cuja perda em centipawns cai
// dentro de [minLoss, maxLoss]:
//   - minLoss (piso)  → garante que o erro é grande o bastante para importar
//                       (era isso que faltava; 17cp é invisível numa partida);
//   - maxLoss (teto)  → impede o lance absurdo ("dar a dama de graça");
//   - filtro de mate  → descarta qualquer linha que entregue mate CONTRA nós.
//                       Necessário na prática: em posições táticas o MultiPV
//                       traz linhas que são mate em 2 contra.
//
// Isso produz o que faltava: a IA deixa passar táticas de 1-2 lances e entrega
// material de vez em quando, com lances legais e plausíveis — erro humano, não
// aleatoriedade.
//
// UCI_LimitStrength + UCI_Elo continua NÃO sendo usado: o piso de UCI_Elo do
// Stockfish é 1320 (confirmado no binário em uso), acima dos níveis Iniciante
// e Fácil que queremos expressar.
//
// A coluna `elo` é só o alvo aproximado exibido na UI ("Fácil · ~1100").
// ─────────────────────────────────────────────────────────────────────────────

// ⚙️  PONTO ÚNICO DE AJUSTE DA DIFICULDADE ⚙️
//
// Todos os valores da janela de erro vivem AQUI. Para deixar um nível mais
// fácil, mexa nestes três números (e em nada mais no arquivo):
//   - blunderChance ↑ → erra com mais frequência
//   - minLoss       ↑ → quando erra, o erro é mais caro
//   - maxLoss       ↑ → permite erros maiores (cuidado: acima de ~900cp o
//                       lance começa a parecer absurdo, não humano)
//
// Perdas médias MEDIDAS com estes valores (cp por lance, quanto maior mais
// fraco) e a força humana aproximada correspondente:
//   beginner ~140cp (~800-1000 Elo) · easy ~80cp (~1100-1400)
//   medium    ~33cp (~1700)         · hard  ~10cp (~2000) · master 0cp
//
// Se o teste em device apontar que o Iniciante AINDA está difícil, o próximo
// passo já mapeado é afrouxar para ~200cp: beginner → { blunderChance: 0.9,
// minLoss: 200, maxLoss: 1200 }. Não é preciso tocar em mais nada.
const ERROR_WINDOWS = {
  beginner: { blunderChance: 0.8, minLoss: 150, maxLoss: 900 },
  easy: { blunderChance: 0.7, minLoss: 100, maxLoss: 600 },
  // medium/hard: chance e teto reduzidos em relação ao primeiro rascunho
  // (0.45/300 e 0.25/200) porque a medição empírica com a engine real deu
  // 52cp e 32cp — acima do alvo da curva. Estes valores foram remedidos.
  medium: { blunderChance: 0.3, minLoss: 50, maxLoss: 220 },
  // No Difícil a janela é estreita de propósito: medindo o nível SEM erro
  // injetado, o Skill do próprio Stockfish já responde por boa parte da
  // perda — sobra pouca margem antes de estourar o alvo de ≤20cp.
  hard: { blunderChance: 0.1, minLoss: 30, maxLoss: 100 },
  // Mestre joga a força total do engine: sem janela, sem erro injetado.
  master: null,
};

// Limites de busca por nível. `multipv` precisa ser alto nos níveis fracos
// para que existam linhas ruins o bastante dentro da janela — foi a ausência
// disso que inutilizou a calibragem anterior. MultiPV 20 foi medido e satura
// (141cp vs 140cp do MultiPV 16), então 16 é o teto útil.
const LEVELS = {
  beginner: { skill: 0, depth: 4, movetime: 250, elo: 800, multipv: 16 },
  easy: { skill: 0, depth: 4, movetime: 250, elo: 1100, multipv: 12 },
  medium: { skill: 4, depth: 6, movetime: 400, elo: 1400, multipv: 8 },
  // Difícil em Skill 12/depth 10: com Skill 9 o ruído do próprio engine já
  // custava ~18cp por lance, estourando o alvo antes da janela de erro entrar.
  hard: { skill: 12, depth: 10, movetime: 700, elo: 1700, multipv: 5 },
  // Mestre em Skill 20 (força máxima real): Skill 18 ainda introduzia ruído
  // próprio (~6cp medidos), e o Mestre não deve errar nada por acidente.
  master: { skill: 20, depth: 12, movetime: 1200, elo: 2000, multipv: 1 },
};

const DEFAULT_LEVEL = "medium";

/** Ordem dos níveis do mais fraco ao mais forte — usada pelos testes de
 *  monotonicidade e por quem precise iterar a curva. */
const LEVEL_ORDER = ["beginner", "easy", "medium", "hard", "master"];

/** Score de mate normalizado para centipawns, para comparar com `score cp`
 *  na mesma escala (mate a favor = ganho enorme; contra = perda enorme). */
const MATE_SCORE = 10000;

/**
 * Resolve o parâmetro de dificuldade em limites de engine + janela de erro.
 * Aceita: chave de nível ("beginner".."master"), número (depth legado, força
 * máxima) ou undefined (→ nível padrão).
 */
function resolveLevel(level) {
  if (typeof level === "string" && LEVELS[level]) {
    return { ...LEVELS[level], errorWindow: ERROR_WINDOWS[level] ?? null };
  }
  if (typeof level === "number") {
    // Compatibilidade com o contrato antigo (depth puro, sem cap de skill/tempo).
    const depth = Math.max(1, Math.min(level, 20));
    return { skill: 20, depth, movetime: 0, multipv: 1, errorWindow: null };
  }
  return { ...LEVELS[DEFAULT_LEVEL], errorWindow: ERROR_WINDOWS[DEFAULT_LEVEL] };
}

/**
 * Extrai { index, move, cp, mate } de uma linha
 * "info ... multipv N ... score cp X ... pv <lance> ...".
 * Retorna null se a linha não tiver índice de multipv e lance — o score pode
 * faltar em linhas parciais, e nesse caso vem como null.
 */
function parseMultipvLine(line) {
  const multipvMatch = line.match(/\bmultipv (\d+)\b/);
  const pvMatch = line.match(/\bpv (\S+)/);
  if (!multipvMatch || !pvMatch) return null;
  const cpMatch = line.match(/\bscore cp (-?\d+)\b/);
  const mateMatch = line.match(/\bscore mate (-?\d+)\b/);
  return {
    index: Number(multipvMatch[1]),
    move: pvMatch[1],
    cp: cpMatch ? Number(cpMatch[1]) : null,
    mate: mateMatch ? Number(mateMatch[1]) : null,
  };
}

/** Converte a avaliação de uma linha para centipawns comparáveis. */
function lineScore(line) {
  if (!line) return null;
  if (line.mate !== null && line.mate !== undefined) {
    return line.mate > 0 ? MATE_SCORE : -MATE_SCORE;
  }
  return line.cp ?? null;
}

/**
 * Escolhe o lance a jogar aplicando a janela de erro do nível.
 *
 * `pvLines` é o mapa { índiceMultiPV: linha } capturado do stdout. `bestMove` é
 * o bestmove que o próprio engine reportou (já com o ruído do Skill Level).
 *
 * Regras, nesta ordem:
 *   1. Sem janela (Mestre / contrato legado) → joga o bestmove.
 *   2. Sorteio acima de blunderChance → joga a melhor linha (ou o bestmove).
 *   3. Candidatos = linhas que NÃO entregam mate contra e cuja perda ≤ maxLoss.
 *   4. Dentre eles, os que perdem ≥ minLoss formam a janela alvo → sorteio
 *      uniforme. Se a janela estiver vazia (posição quieta, todas as linhas
 *      equivalentes), joga o pior candidato seguro disponível.
 */
function pickMove(bestMove, pvLines, errorWindow) {
  if (!errorWindow) return bestMove;
  const { blunderChance, minLoss, maxLoss } = errorWindow;

  const top = pvLines[1];
  const topScore = lineScore(top);
  if (!top || topScore === null) return bestMove;

  if (!blunderChance || Math.random() >= blunderChance) return bestMove;

  const safe = [];
  for (const key of Object.keys(pvLines)) {
    const line = pvLines[key];
    // Nunca escolher um lance que entrega mate contra nós — é o que
    // separa "erro humano" de "dar a dama de graça".
    if (line.mate !== null && line.mate !== undefined && line.mate < 0) continue;
    if (line.cp === null || line.cp === undefined) continue;
    const loss = topScore - line.cp;
    if (loss >= 0 && loss <= maxLoss) safe.push({ move: line.move, loss });
  }
  if (safe.length === 0) return bestMove;

  const inWindow = safe.filter((c) => c.loss >= minLoss);
  if (inWindow.length > 0) {
    return inWindow[Math.floor(Math.random() * inWindow.length)].move;
  }
  // Fallback: nenhuma linha erra o bastante para a janela do nível (posição
  // quieta) — joga a pior segura, para não voltar a jogar sempre a melhor.
  return safe.sort((a, b) => b.loss - a.loss)[0].move;
}

// Pool de engines quentes + teto de concorrência. Ver enginePool.js para o
// porquê (o spawn por requisição custava ~95% do tempo de resposta e saturava
// a CPU sob concorrência).
const pool = new EnginePool();

/**
 * Melhor lance da engine para `fen`, já com a janela de erro do nível aplicada.
 * Devolve null quando não há lance legal na posição ("bestmove (none)").
 */
async function getBestMove(fen, level = DEFAULT_LEVEL) {
  const { skill, depth, movetime, multipv = 1, errorWindow } = resolveLevel(level);
  // Janela de timeout: tempo de análise + folga. A folga pôde encolher de 5s
  // para 2s porque o engine já vem quente do pool — não há mais spawn nem
  // carga de rede NNUE dentro desta janela.
  const timeoutMs = (movetime || depth * 1000) + 2000;
  const goCmd = movetime
    ? `go depth ${depth} movetime ${movetime}\n`
    : `go depth ${depth}\n`;

  const engine = await pool.acquire();
  let healthy = true;
  try {
    const { bestMove, pvLines } = await engine.search({
      skill,
      multipv,
      fen,
      goCmd,
      timeoutMs,
      parseLine: parseMultipvLine,
    });
    if (!bestMove) return null;
    return pickMove(bestMove, pvLines, errorWindow);
  } catch (err) {
    // Timeout/erro no meio de uma busca deixa o engine em estado indefinido
    // (pode haver um `bestmove` atrasado a caminho). Não devolve ao pool.
    healthy = false;
    pool.discard(engine);
    throw err;
  } finally {
    if (healthy) pool.release(engine);
  }
}

module.exports = {
  getBestMove,
  LEVELS,
  ERROR_WINDOWS,
  LEVEL_ORDER,
  DEFAULT_LEVEL,
  MATE_SCORE,
  resolveLevel,
  // Exportados para teste unitário isolado (sem depender do binário
  // stockfish real): parsing de linha UCI e escolha com janela de erro.
  parseMultipvLine,
  lineScore,
  pickMove,
  // Operacional: métricas do pool e encerramento limpo (testes e SIGTERM).
  poolStats: () => pool.stats(),
  shutdownPool: () => pool.shutdown(),
};
