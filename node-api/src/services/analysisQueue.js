const { analyzeGame, UnanalyzableGameError } = require("./analysis.service");

// ─────────────────────────────────────────────────────────────────────────────
// O worker que PUXA trabalho do Django.
//
// A fila mora no Postgres, não aqui. O node-api pergunta "tem partida para
// analisar?", recebe os lances na resposta, analisa e devolve o resultado — tudo
// na direção node-api → Django, a única que já existe (mesmo X-Internal-Secret
// dos outros endpoints internos). Nenhum canal Django → node-api é criado.
//
// O motivo não é elegância: este processo reinicia a cada deploy e perde o que
// está em memória. Com a fila no banco, uma análise interrompida volta a ser
// entregue em vez de sumir — o Django reabre o trabalho quando o aluguel vence.
//
// Ver docs/execution/PLANO_FASE2_ANALISE_POS_JOGO.md §1.
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";

/** Espelha a flag do Django. Desligada por padrão: sem ela, este processo
 *  ficaria batendo num endpoint que nunca tem trabalho. Ligar as duas pontas é
 *  decisão consciente, tomada olhando o `engine.queued` do /health. */
const ANALYSIS_ENABLED = process.env.POST_GAME_ANALYSIS_ENABLED === "true";

/** Intervalo entre perguntas ao Django quando não há trabalho. 15s é
 *  irrelevante para o usuário (a tela já mostra "analisando…") e mantém o
 *  tráfego de polling desprezível. */
const POLL_INTERVAL_MS = Number(process.env.ANALYSIS_POLL_MS) || 15000;

/** Depois de analisar uma partida, pergunta de novo quase na hora: se há fila
 *  acumulada, não faz sentido esperar o intervalo cheio entre uma e outra. */
const BUSY_INTERVAL_MS = 500;

const NEXT_URL = `${BACKEND_URL}/api/v1/auth/internal/analysis/next/`;
const RESULT_URL = `${BACKEND_URL}/api/v1/auth/internal/analysis/result/`;

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Internal-Secret": INTERNAL_SECRET,
  };
}

/**
 * Pede a próxima partida. Devolve o trabalho, ou null quando não há nada.
 * Nunca lança: falha de rede é "tenta de novo no próximo tick".
 */
async function claimWork() {
  try {
    const res = await fetch(NEXT_URL, { headers: headers() });
    if (res.status === 204) return null;
    if (!res.ok) {
      console.error(`[Analysis] fila respondeu ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("[Analysis] falha ao consultar a fila:", err.message);
    return null;
  }
}

/**
 * Devolve o resultado (ou a falha) ao Django. Devolve true se o Django aceitou.
 *
 * Não devolver é recuperável: o aluguel vence e a partida volta para a fila.
 * Por isso um erro aqui é logado e engolido, nunca propagado.
 */
async function reportResult(payload) {
  try {
    const res = await fetch(RESULT_URL, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[Analysis] backend recusou o resultado: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Analysis] falha ao devolver o resultado:", err.message);
    return false;
  }
}

/**
 * Processa UMA partida, do claim ao report. Devolve true se havia trabalho.
 *
 * Falha TERMINAL (lance ilegal, partida sem lances) é reportada como `failed`
 * para sair da fila de vez: tentar de novo não melhora o dado. Falha
 * transitória (engine morreu, timeout) NÃO é reportada — deixar o aluguel
 * vencer devolve a partida à fila, que é o comportamento certo.
 */
async function processOne() {
  const work = await claimWork();
  if (!work) return false;

  const startedAt = Date.now();
  console.log(
    `[Analysis] analisando partida ${work.game_public_id} ` +
      `(${(work.moves || []).length} lances)`
  );

  try {
    const report = await analyzeGame({
      moves: work.moves,
      initialFen: work.initial_fen,
      result: work.result,
      maxPlies: work.max_plies,
    });

    const elapsed = Date.now() - startedAt;
    const leaseMs = Number(work.lease_seconds || 0) * 1000;
    if (leaseMs > 0 && elapsed > leaseMs) {
      // O Django pode já ter devolvido esta partida à fila. Reportar mesmo
      // assim é inofensivo (a escrita é idempotente), mas o aviso é o sinal de
      // que o aluguel está curto demais para o tamanho das partidas reais.
      console.warn(
        `[Analysis] análise passou do aluguel (${elapsed}ms > ${leaseMs}ms)`
      );
    }

    await reportResult({ analysis_id: work.analysis_id, ...report });
    console.log(
      `[Analysis] partida ${work.game_public_id} pronta em ${elapsed}ms ` +
        `(${report.analyzed_plies} lances)`
    );
  } catch (err) {
    if (err instanceof UnanalyzableGameError) {
      console.warn(
        `[Analysis] partida ${work.game_public_id} impossível de analisar: ${err.message}`
      );
      await reportResult({
        analysis_id: work.analysis_id,
        failed: true,
        failure_reason: err.message,
      });
    } else {
      // Transitório: não reporta. O aluguel vence e a partida volta sozinha.
      console.error(
        `[Analysis] falha transitória em ${work.game_public_id}:`,
        err.message
      );
    }
  }

  return true;
}

let timer = null;
let running = false;

/**
 * Liga o worker. Auto-agendado (e não `setInterval`) para nunca haver duas
 * análises em voo: o próximo tick só é marcado quando o anterior termina.
 */
function startAnalysisWorker({ enabled = ANALYSIS_ENABLED } = {}) {
  if (!enabled) {
    console.log(
      "[Analysis] análise pós-jogo DESLIGADA (POST_GAME_ANALYSIS_ENABLED)"
    );
    return null;
  }
  if (!INTERNAL_SECRET) {
    console.warn(
      "[Analysis] INTERNAL_API_SECRET não configurado — worker não iniciado."
    );
    return null;
  }
  if (running) return timer;

  running = true;
  console.log(`[Analysis] worker ligado (polling a cada ${POLL_INTERVAL_MS}ms)`);

  const tick = async () => {
    let hadWork = false;
    try {
      hadWork = await processOne();
    } catch (err) {
      // Rede de segurança: nada aqui pode derrubar o processo que atende as
      // partidas ao vivo.
      console.error("[Analysis] erro inesperado no worker:", err.message);
    }
    if (!running) return;
    timer = setTimeout(tick, hadWork ? BUSY_INTERVAL_MS : POLL_INTERVAL_MS);
    timer.unref?.();
  };

  timer = setTimeout(tick, POLL_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

function stopAnalysisWorker() {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

module.exports = {
  startAnalysisWorker,
  stopAnalysisWorker,
  processOne,
  claimWork,
  reportResult,
  ANALYSIS_ENABLED,
  POLL_INTERVAL_MS,
};
