const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";

// timeControlSecs define a MODALIDADE Glicko-2 no backend
// (bullet/blitz/rapid). Ele não decide mais se a partida vale rating: toda
// partida que passa por aqui é humano-vs-humano e vale, sempre — quem
// decide isso é o servidor Django, com `rated` constante do endpoint.
//
// Retorna o payload do backend (com `rated` e o `delta` de cada jogador) ou
// null se a chamada falhar — o chamador usa isso para avisar os dois lados do
// resultado do rating. Nunca lança: um erro aqui não pode derrubar o fim da
// partida.
async function reportGameResult(whiteId, blackId, result, timeControlSecs = null) {
  if (!INTERNAL_SECRET) {
    console.warn("[GameResult] INTERNAL_API_SECRET não configurado, resultado não reportado.");
    return null;
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
      return null;
    }

    const data = await res.json();
    console.log(
      `[GameResult] rating atualizado (${data.modality ?? "?"}) — ` +
        `brancas: ${data.white.rating} (${data.white.delta >= 0 ? "+" : ""}${data.white.delta}) ` +
        `pretas: ${data.black.rating} (${data.black.delta >= 0 ? "+" : ""}${data.black.delta})`
    );
    return data;
  } catch (err) {
    console.error("[GameResult] Falha na chamada ao backend:", err.message);
    return null;
  }
}

// Histórico de cor dos jogadores candidatos ao pareamento (Item 6). Uma
// chamada para os DOIS: o pareamento precisa dos dois ao mesmo tempo e duas
// idas ao Django dobrariam a latência do join_queue.
//
// Fail-open, igual ao canPlayGame: se o backend não responder, o pareamento
// não trava — quem chama cai no sorteio. Balancear cor é melhoria de
// experiência, não pode ser ponto único de falha do matchmaking.
async function getColorBalance(userIds) {
  if (!INTERNAL_SECRET) return null;

  try {
    const query = userIds
      .map((id) => `user_id=${encodeURIComponent(id)}`)
      .join("&");
    const res = await fetch(
      `${BACKEND_URL}/api/v1/auth/internal/color-balance/?${query}`,
      { headers: { "X-Internal-Secret": INTERNAL_SECRET } }
    );
    if (!res.ok) {
      console.error(`[ColorBalance] backend respondeu ${res.status}, sorteando`);
      return null;
    }
    const data = await res.json();
    return data.players ?? null;
  } catch (err) {
    console.error("[ColorBalance] falha na consulta, sorteando:", err.message);
    return null;
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

module.exports = { reportGameResult, canPlayGame, getColorBalance };
