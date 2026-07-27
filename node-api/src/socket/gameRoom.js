const { Chess } = require("chess.js");
const { getRedis } = require("../services/redis.service");
const { setUserGame } = require("./matchmaking");

const GAME_PREFIX = "game:";
const ROOM_PREFIX = "room:";
const GAME_TTL = 7200; // 2 hours

function generateId(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

async function createGame(whitePlayer, blackPlayer, timeControlSecs = null) {
  const redis = getRedis();
  const gameId = generateId(8);
  const chess = new Chess();
  const timeMs = timeControlSecs ? timeControlSecs * 1000 : null;

  const gameData = {
    fen: chess.fen(),
    white_id: String(whitePlayer.userId),
    black_id: String(blackPlayer.userId),
    white_socket: whitePlayer.socketId,
    black_socket: blackPlayer.socketId,
    white_meta: JSON.stringify(whitePlayer.meta || {}),
    black_meta: JSON.stringify(blackPlayer.meta || {}),
    status: "active",
    created_at: String(Date.now()),
    time_control: timeControlSecs !== null ? String(timeControlSecs) : "",
    white_time_ms: timeMs !== null ? String(timeMs) : "",
    black_time_ms: timeMs !== null ? String(timeMs) : "",
    last_move_at: "",
  };

  await redis.hset(`${GAME_PREFIX}${gameId}`, gameData);
  await redis.expire(`${GAME_PREFIX}${gameId}`, GAME_TTL);

  await setUserGame(whitePlayer.userId, gameId);
  await setUserGame(blackPlayer.userId, gameId);

  return gameId;
}

async function getGame(gameId) {
  const redis = getRedis();
  const data = await redis.hgetall(`${GAME_PREFIX}${gameId}`);
  if (!data || !data.fen) return null;
  return data;
}

async function updateGame(gameId, fields) {
  const redis = getRedis();
  await redis.hset(`${GAME_PREFIX}${gameId}`, fields);
  await redis.expire(`${GAME_PREFIX}${gameId}`, GAME_TTL);
}

async function applyMove(gameId, userId, from, to, promotion) {
  const game = await getGame(gameId);
  if (!game) return { error: "Partida não encontrada" };
  if (game.status !== "active") return { error: "Partida encerrada" };

  const chess = new Chess(game.fen);
  const turn = chess.turn(); // 'w' or 'b'
  const isWhite = String(game.white_id) === String(userId);
  const isBlack = String(game.black_id) === String(userId);

  if (!isWhite && !isBlack) return { error: "Você não está nesta partida" };
  if (turn === "w" && !isWhite) return { error: "Não é sua vez" };
  if (turn === "b" && !isBlack) return { error: "Não é sua vez" };

  // ── Time control ──────────────────────────────────────────────────────────
  const timeControlSecs = game.time_control ? parseInt(game.time_control) : null;
  let whiteTimeMs = game.white_time_ms ? parseInt(game.white_time_ms) : null;
  let blackTimeMs = game.black_time_ms ? parseInt(game.black_time_ms) : null;

  if (timeControlSecs && game.last_move_at) {
    const elapsed = Date.now() - parseInt(game.last_move_at);
    if (isWhite) {
      whiteTimeMs = Math.max(0, whiteTimeMs - elapsed);
    } else {
      blackTimeMs = Math.max(0, blackTimeMs - elapsed);
    }

    if ((isWhite && whiteTimeMs <= 0) || (isBlack && blackTimeMs <= 0)) {
      await updateGame(gameId, { status: "finished" });
      await setUserGame(game.white_id, null);
      await setUserGame(game.black_id, null);
      return {
        timeout: true,
        loser: isWhite ? "white" : "black",
        white_id: game.white_id,
        black_id: game.black_id,
        time_control: timeControlSecs,
      };
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const moveOptions = promotion ? { from, to, promotion } : { from, to };
  const moveResult = chess.move(moveOptions);
  if (!moveResult) return { error: "Movimento inválido" };

  const newFen = chess.fen();
  let status = "active";
  let gameOver = null;

  if (chess.isCheckmate()) {
    status = "finished";
    gameOver = {
      winner: turn === "w" ? "white" : "black",
      reason: "checkmate",
    };
  } else if (chess.isDraw()) {
    status = "finished";
    gameOver = {
      winner: null,
      reason: chess.isStalemate()
        ? "stalemate"
        : chess.isThreefoldRepetition()
        ? "repetition"
        : chess.isInsufficientMaterial()
        ? "insufficient"
        : "draw",
    };
  }

  // Update time and last_move_at
  const now = Date.now();
  const timeUpdates = {};
  if (timeControlSecs) {
    if (isWhite) timeUpdates.white_time_ms = String(whiteTimeMs);
    else timeUpdates.black_time_ms = String(blackTimeMs);
    timeUpdates.last_move_at = String(now);
  }

  await updateGame(gameId, { fen: newFen, status, ...timeUpdates });

  if (status === "finished") {
    await setUserGame(game.white_id, null);
    await setUserGame(game.black_id, null);
  }

  return {
    fen: newFen,
    move: { from: moveResult.from, to: moveResult.to, san: moveResult.san, flags: moveResult.flags },
    turn: chess.turn(),
    check: chess.inCheck(),
    checkmate: chess.isCheckmate(),
    draw: chess.isDraw(),
    gameOver,
    white_time_ms: whiteTimeMs,
    black_time_ms: blackTimeMs,
  };
}

async function resignGame(gameId, userId) {
  const game = await getGame(gameId);
  if (!game) return { error: "Partida não encontrada" };
  if (game.status !== "active") return { error: "Partida já encerrada" };

  await updateGame(gameId, { status: "finished" });
  await setUserGame(game.white_id, null);
  await setUserGame(game.black_id, null);

  const resigningIsWhite = String(game.white_id) === String(userId);
  return {
    winner: resigningIsWhite ? "black" : "white",
    reason: "resign",
    white_id: game.white_id,
    black_id: game.black_id,
    time_control: game.time_control ? parseInt(game.time_control) : null,
  };
}

// Proposta de empate expira sozinha para não travar a partida se o
// oponente desconectar ou ignorar o modal (o cliente também expira aos 30s).
const DRAW_OFFER_TTL_MS = 60_000;

async function offerDraw(gameId, userId) {
  const game = await getGame(gameId);
  if (!game) return { error: "Partida não encontrada" };
  if (game.status !== "active") return { error: "Partida já encerrada" };

  const isWhite = String(game.white_id) === String(userId);
  const isBlack = String(game.black_id) === String(userId);
  if (!isWhite && !isBlack) return { error: "Você não está nesta partida" };

  await updateGame(gameId, {
    draw_offer_by: String(userId),
    draw_offer_at: String(Date.now()),
  });

  return {
    offered_by: String(userId),
    white_id: game.white_id,
    black_id: game.black_id,
  };
}

async function acceptDraw(gameId, userId) {
  const game = await getGame(gameId);
  if (!game) return { error: "Partida não encontrada" };
  if (game.status !== "active") return { error: "Partida já encerrada" };

  const isWhite = String(game.white_id) === String(userId);
  const isBlack = String(game.black_id) === String(userId);
  if (!isWhite && !isBlack) return { error: "Você não está nesta partida" };

  const offeredBy = game.draw_offer_by;
  if (!offeredBy || String(offeredBy) === String(userId)) {
    return { error: "Não há proposta de empate do oponente" };
  }

  const offeredAt = parseInt(game.draw_offer_at || "0");
  if (Date.now() - offeredAt > DRAW_OFFER_TTL_MS) {
    await updateGame(gameId, { draw_offer_by: "", draw_offer_at: "" });
    return { error: "A proposta de empate expirou" };
  }

  await updateGame(gameId, {
    status: "finished",
    draw_offer_by: "",
    draw_offer_at: "",
  });
  await setUserGame(game.white_id, null);
  await setUserGame(game.black_id, null);

  return {
    winner: null,
    reason: "agreement",
    white_id: game.white_id,
    black_id: game.black_id,
    time_control: game.time_control ? parseInt(game.time_control) : null,
  };
}

async function declineDraw(gameId, userId) {
  const game = await getGame(gameId);
  if (!game) return { error: "Partida não encontrada" };

  const offeredBy = game.draw_offer_by;
  if (!offeredBy || String(offeredBy) === String(userId)) {
    return { error: "Não há proposta de empate do oponente" };
  }

  await updateGame(gameId, { draw_offer_by: "", draw_offer_at: "" });

  return {
    declined_by: String(userId),
    offered_by: offeredBy,
    white_id: game.white_id,
    black_id: game.black_id,
  };
}

async function updateSocket(gameId, userId, newSocketId) {
  const game = await getGame(gameId);
  if (!game) return;
  const isWhite = String(game.white_id) === String(userId);
  await updateGame(gameId, { [isWhite ? "white_socket" : "black_socket"]: newSocketId });
}

// ── Salas privadas / convites ───────────────────────────────────────────────
//
// Handshake genérico de convite sobre uma sala, com quatro passos:
//
//   PROPOR  → createRoom()            (+ emissão do convite, no index.js)
//   ACEITAR → joinRoom()              (vira partida)
//   RECUSAR → closeRoom() pelo convidado
//   SAIR    → closeRoom() pelo criador
//
// RECUSAR e SAIR são o MESMO teardown — só muda o `reason` derivado do papel
// de quem fechou. `kind` identifica QUAL convite é ("friend" hoje; a revanche
// entra como outro kind e reaproveita createRoom/joinRoom/closeRoom sem
// duplicar ciclo de vida).
const ROOM_KIND_FRIEND = "friend";

// Motivos de fechamento reportados aos dois lados. Derivados no servidor (do
// papel de quem fecha), nunca aceitos do cliente.
const ROOM_CLOSE_CANCELLED = "cancelled"; // criador desistiu de esperar
const ROOM_CLOSE_DECLINED = "declined"; // convidado recusou
const ROOM_CLOSE_EXPIRED = "expired"; // sala já não existe (TTL/2º fechamento)

async function createRoom(creatorId, creatorSocketId, meta = {}, options = {}) {
  const redis = getRedis();
  const code = generateId(6);
  const roomData = {
    creator_id: String(creatorId),
    creator_socket: creatorSocketId,
    creator_meta: JSON.stringify(meta),
    kind: options.kind || ROOM_KIND_FRIEND,
    // Preenchido quando a sala nasce de um convite direto — é quem precisa
    // ser avisado se o criador cancelar. Sala só-por-código não tem alvo
    // conhecido e fica vazio.
    invitee_id: options.inviteeId != null ? String(options.inviteeId) : "",
    status: "waiting",
    created_at: String(Date.now()),
  };
  await redis.hset(`${ROOM_PREFIX}${code}`, roomData);
  await redis.expire(`${ROOM_PREFIX}${code}`, 600); // 10 min to join
  return code;
}

/**
 * Invalida a sala e diz QUEM precisa ser avisado do outro lado.
 *
 * Idempotente por construção: fechar uma sala inexistente devolve
 * `reason: "expired"` em vez de erro — quem chamou ainda precisa destravar a
 * própria tela, e a sala pode ter morrido pelo TTL de 10 min.
 */
async function closeRoom(code, userId) {
  const redis = getRedis();
  const room = await redis.hgetall(`${ROOM_PREFIX}${code}`);

  if (!room || !room.creator_id) {
    return { reason: ROOM_CLOSE_EXPIRED, notifyUserId: null, kind: null };
  }

  const isCreator = String(room.creator_id) === String(userId);
  const isInvitee =
    !!room.invitee_id && String(room.invitee_id) === String(userId);
  if (!isCreator && !isInvitee) {
    return { error: "Você não participa desta sala" };
  }

  await redis.del(`${ROOM_PREFIX}${code}`);

  return {
    kind: room.kind || ROOM_KIND_FRIEND,
    reason: isCreator ? ROOM_CLOSE_CANCELLED : ROOM_CLOSE_DECLINED,
    // O outro lado do convite. Criador fechando → avisa o convidado (se
    // houver); convidado fechando → avisa o criador.
    notifyUserId: isCreator ? room.invitee_id || null : room.creator_id,
  };
}

async function joinRoom(code, joinerId, joinerSocketId, joinerMeta = {}) {
  const redis = getRedis();
  const room = await redis.hgetall(`${ROOM_PREFIX}${code}`);
  if (!room || !room.creator_id) return { error: "Sala não encontrada" };
  if (room.status !== "waiting") return { error: "Sala já iniciada" };
  if (String(room.creator_id) === String(joinerId)) return { error: "Você criou esta sala" };

  await redis.del(`${ROOM_PREFIX}${code}`);

  // Randomly assign colors
  const creatorIsWhite = Math.random() < 0.5;
  const white = creatorIsWhite
    ? { userId: room.creator_id, socketId: room.creator_socket, meta: JSON.parse(room.creator_meta || "{}") }
    : { userId: joinerId, socketId: joinerSocketId, meta: joinerMeta };
  const black = creatorIsWhite
    ? { userId: joinerId, socketId: joinerSocketId, meta: joinerMeta }
    : { userId: room.creator_id, socketId: room.creator_socket, meta: JSON.parse(room.creator_meta || "{}") };

  const gameId = await createGame(white, black);
  return { gameId, white, black };
}

module.exports = {
  createGame,
  getGame,
  applyMove,
  resignGame,
  offerDraw,
  acceptDraw,
  declineDraw,
  updateSocket,
  createRoom,
  joinRoom,
  closeRoom,
  ROOM_KIND_FRIEND,
  ROOM_CLOSE_CANCELLED,
  ROOM_CLOSE_DECLINED,
  ROOM_CLOSE_EXPIRED,
};
