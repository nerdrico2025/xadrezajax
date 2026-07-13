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

module.exports = { reportGameResult };
