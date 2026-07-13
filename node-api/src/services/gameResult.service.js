const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";

// timeControlSecs define a modalidade Glicko-2 no backend (bullet/blitz/rapid);
// null = partida sem relógio (salas privadas) → rápido.
async function reportGameResult(whiteId, blackId, result, timeControlSecs = null) {
  if (!INTERNAL_SECRET) {
    console.warn("[GameResult] INTERNAL_API_SECRET não configurado, resultado não reportado.");
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/auth/game/result/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        white_id: whiteId,
        black_id: blackId,
        result,
        time_control: timeControlSecs,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[GameResult] Erro ao reportar resultado: ${res.status} ${body}`);
      return;
    }

    const data = await res.json();
    console.log(
      `[GameResult] rating atualizado (${data.modality ?? "?"}) — brancas: ${data.white.rating} pretas: ${data.black.rating}`
    );
  } catch (err) {
    console.error("[GameResult] Falha na chamada ao backend:", err.message);
  }
}

// Gating pré-fila (RF-MON-05): consulta o Django antes de colocar o jogador
// na fila de matchmaking — o bloqueio acontece ANTES do pareamento, nunca
// depois. Fail-open: se o backend estiver indisponível (ou o segredo não
// configurado), o matchmaking não trava — a defesa em profundidade continua
// no registro do resultado.
async function canPlayGame(userId) {
  if (!INTERNAL_SECRET) return { can_play: true };

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/payments/internal/can-play/?user_id=${encodeURIComponent(userId)}`,
      { headers: { "X-Internal-Secret": INTERNAL_SECRET } }
    );
    if (!res.ok) {
      console.error(`[CanPlay] backend respondeu ${res.status}, liberando por segurança`);
      return { can_play: true };
    }
    return await res.json();
  } catch (err) {
    console.error("[CanPlay] falha na consulta, liberando por segurança:", err.message);
    return { can_play: true };
  }
}

module.exports = { reportGameResult, canPlayGame };
