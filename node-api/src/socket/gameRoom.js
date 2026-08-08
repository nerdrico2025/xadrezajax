const { Chess } = require("chess.js");
const { getRedis } = require("../services/redis.service");
const { setUserGame, renewUserGame } = require("./matchmaking");
const { GAME_TTL } = require("./ttl");

const GAME_PREFIX = "game:";
const ROOM_PREFIX = "room:";
// Lances da partida em SAN, na ordem jogada (lista Redis, um RPUSH por lance
// validado). Chave separada do hash `game:{id}` porque é uma LISTA que só
// cresce — enfiá-la no hash exigiria reserializar a partida inteira a cada
// lance. Vive e morre junto com o hash: mesmo GAME_TTL, renovado no mesmo
// ponto (ver updateGame).
const MOVES_SUFFIX = ":moves";

function movesKey(gameId) {
  return `${GAME_PREFIX}${gameId}${MOVES_SUFFIX}`;
}

// Relógio de partida humana. Toda partida humano-vs-humano tem relógio — não
// existe partida humana sem relógio (e toda partida humana vale rating, então
// "sem relógio" seria rota de fuga para quem está perdendo).
//
// O cliente SUGERE um valor (o anfitrião escolhe no convite, a busca rápida
// manda a preferência salva em Ajustes); o servidor só aceita se estiver
// nesta lista. Qualquer outra coisa cai no default.
//
// Os valores espelham as durações já usadas no wizard vs IA
// (mobile/constants/aiGame.ts, AI_TIME_CONTROLS) MENOS "sem tempo", que não
// existe para humano.
const HUMAN_TIME_CONTROLS_SECS = [60, 180, 300, 600, 900];
const DEFAULT_TIME_CONTROL_SECS = 600;

/** Normaliza o tempo pedido pelo cliente. Fora da lista → default. */
function resolveHumanTimeControl(requested) {
  const value = Number(requested);
  return HUMAN_TIME_CONTROLS_SECS.includes(value)
    ? value
    : DEFAULT_TIME_CONTROL_SECS;
}

/** Normaliza a cor pedida pelo anfitrião do convite. Só "w"/"b" valem;
 *  qualquer outra coisa (inclusive ausente) vira sorteio no joinRoom. */
function resolveHostColor(requested) {
  return requested === "w" || requested === "b" ? requested : null;
}

// Carência para reconectar antes de a partida ser encerrada por abandono.
// Limitada pelo relógio do jogador que caiu — vale o que terminar primeiro
// (ver abandonGraceMs).
const ABANDON_GRACE_MS = 60_000;

// Um único Math.random() rende ~10 caracteres base36, então uma fatia maior
// que isso saía CURTA (e com menos entropia do que o tamanho pedido sugere).
// Concatenar sorteios até completar o tamanho resolve os dois: o id tem
// sempre o comprimento pedido e a entropia cresce junto.
function generateId(len = 8) {
  let out = "";
  while (out.length < len) out += Math.random().toString(36).slice(2);
  return out.slice(0, len).toUpperCase();
}

// Tamanho do id de partida. 12 caracteres base36 (~62 bits) e não 8 (~41
// bits) porque o id passou a ser CHAVE DE IDEMPOTÊNCIA permanente no Django
// (`Game.external_id`, unique). Com 8 caracteres, a chance de duas partidas
// diferentes colidirem ao longo do primeiro milhão de partidas beira 20% — e
// uma colisão faria o Django tratar uma partida nova como resultado repetido
// e descartá-la em silêncio. Não é o código de sala (6 chars, digitado por
// gente); ninguém digita este id.
const GAME_ID_LEN = 12;

async function createGame(whitePlayer, blackPlayer, timeControlSecs = null) {
  const redis = getRedis();
  const gameId = generateId(GAME_ID_LEN);
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
  // Os lances vencem JUNTO com a partida — mesmo TTL, renovado no mesmo
  // ponto. Descasar os dois já custou caro uma vez (ver ttl.js): uma partida
  // viva cujos lances expiraram chegaria ao Django sem nada para gravar.
  await redis.expire(movesKey(gameId), GAME_TTL);
}

/** Lances validados da partida, em SAN, na ordem jogada. */
async function getMoves(gameId) {
  const redis = getRedis();
  return (await redis.lrange(movesKey(gameId), 0, -1)) || [];
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
  // chess.js 1.x LANÇA em lance ilegal (a v0 devolvia null), então sem este
  // try/catch o `if (!moveResult)` abaixo era código morto: a exceção subia
  // até o catch genérico do handler `make_move` e chegava ao jogador como
  // "Erro interno" — mensagem errada para um lance simplesmente ilegal.
  let moveResult;
  try {
    moveResult = chess.move(moveOptions);
  } catch {
    moveResult = null;
  }
  if (!moveResult) return { error: "Movimento inválido" };

  // Grava o lance SÓ depois de o chess.js tê-lo aceitado — a lista é o
  // registro da partida REAL, então nada que não foi jogado pode entrar nela.
  // O `expire` acompanha o do hash em updateGame, logo abaixo.
  await getRedis().rpush(movesKey(gameId), moveResult.san);

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

  // Renova o ponteiro de recuperação dos DOIS jogadores junto com a partida.
  // `updateGame` já esticou o `game:`; sem esta linha o `user:game:` vencia
  // sozinho e o reconnect deixava de funcionar no meio da partida.
  if (status === "active") {
    await renewUserGame(game.white_id);
    await renewUserGame(game.black_id);
  }

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

/**
 * Quanto tempo dar a `userId` para reconectar antes de perder por abandono.
 *
 * Nunca excede o relógio que resta ao próprio jogador: se ele tem 12s de
 * relógio, a carência é de 12s. Senão o abandono viraria tempo extra de
 * graça — quem estivesse perdendo no relógio ganharia 60s fechando o app.
 *
 * Decisão inteiramente do servidor: o cliente não informa nem negocia este
 * valor. Retorna 0 quando o relógio já zerou (encerra imediatamente).
 */
function abandonGraceMs(game, userId) {
  const timeControlSecs = game.time_control ? parseInt(game.time_control) : null;
  // Partida legada sem relógio (anterior ao relógio obrigatório): só a
  // carência fixa limita.
  if (!timeControlSecs) return ABANDON_GRACE_MS;

  const isWhite = String(game.white_id) === String(userId);
  const storedMs = isWhite
    ? parseInt(game.white_time_ms)
    : parseInt(game.black_time_ms);
  if (!Number.isFinite(storedMs)) return ABANDON_GRACE_MS;

  let remainingMs = storedMs;
  // Se for a vez dele, o relógio dele corre desde o último lance — o que já
  // escorreu não conta como carência.
  const isTheirTurn = (new Chess(game.fen).turn() === "w") === isWhite;
  if (isTheirTurn && game.last_move_at) {
    remainingMs -= Date.now() - parseInt(game.last_move_at);
  }

  return Math.max(0, Math.min(ABANDON_GRACE_MS, remainingMs));
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
  // Cor e tempo são escolha EXPLÍCITA do anfitrião no convite, gravadas na
  // sala para o joinRoom aplicar. Normalizadas aqui: o cliente sugere, o
  // servidor decide. Não existe opção de "valer rating" nem de "amistosa" —
  // partida humana sempre vale (ver GameResultView no Django).
  const hostColor = resolveHostColor(options.hostColor);
  const roomData = {
    creator_id: String(creatorId),
    creator_socket: creatorSocketId,
    creator_meta: JSON.stringify(meta),
    kind: options.kind || ROOM_KIND_FRIEND,
    // Preenchido quando a sala nasce de um convite direto — é quem precisa
    // ser avisado se o criador cancelar. Sala só-por-código não tem alvo
    // conhecido e fica vazio.
    invitee_id: options.inviteeId != null ? String(options.inviteeId) : "",
    // "" = anfitrião não escolheu (sala por código antiga) → sorteio.
    host_color: hostColor || "",
    time_control: String(resolveHumanTimeControl(options.timeControl)),
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

  // Cor: a escolha do anfitrião manda — ele pegou brancas ou pretas no
  // convite e o convidado recebe a outra. Sala sem escolha gravada (código
  // antigo, sala criada antes desta versão) mantém o sorteio.
  const hostColor = resolveHostColor(room.host_color);
  const creatorIsWhite = hostColor ? hostColor === "w" : Math.random() < 0.5;

  const creator = {
    userId: room.creator_id,
    socketId: room.creator_socket,
    meta: JSON.parse(room.creator_meta || "{}"),
  };
  const joiner = { userId: joinerId, socketId: joinerSocketId, meta: joinerMeta };

  const white = creatorIsWhite ? creator : joiner;
  const black = creatorIsWhite ? joiner : creator;

  // Relógio decidido no servidor: sala humana nasce COM relógio, sempre — e
  // agora com o tempo que o anfitrião escolheu no convite (já normalizado
  // contra HUMAN_TIME_CONTROLS_SECS no createRoom). Sala sem tempo gravado
  // cai no default.
  const timeControl = resolveHumanTimeControl(room.time_control);
  const gameId = await createGame(white, black, timeControl);
  return { gameId, white, black, timeControl };
}

module.exports = {
  createGame,
  getGame,
  getMoves,
  applyMove,
  resignGame,
  offerDraw,
  acceptDraw,
  declineDraw,
  updateSocket,
  createRoom,
  joinRoom,
  closeRoom,
  abandonGraceMs,
  resolveHumanTimeControl,
  resolveHostColor,
  HUMAN_TIME_CONTROLS_SECS,
  DEFAULT_TIME_CONTROL_SECS,
  ABANDON_GRACE_MS,
  ROOM_KIND_FRIEND,
  ROOM_CLOSE_CANCELLED,
  ROOM_CLOSE_DECLINED,
  ROOM_CLOSE_EXPIRED,
};
