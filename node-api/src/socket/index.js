const { Server } = require("socket.io");
const { getRedis } = require("../services/redis.service");
const { verifySocketToken } = require("./auth");
const { addToQueue, removeFromQueue, findOpponent, getUserGame, QUEUE_KEY, QUEUE_MAX_AGE_MS } = require("./matchmaking");
const { reportGameResult } = require("../services/gameResult.service");
const {
  createGame,
  getGame,
  applyMove,
  resignGame,
  updateSocket,
  createRoom,
  joinRoom,
} = require("./gameRoom");

function buildGameStartPayload(gameId, game) {
  return {
    game_id: gameId,
    fen: game.fen,
    white: { id: game.white_id, ...JSON.parse(game.white_meta || "{}") },
    black: { id: game.black_id, ...JSON.parse(game.black_meta || "{}") },
    time_control: game.time_control ? parseInt(game.time_control) : null,
    white_time_ms: game.white_time_ms ? parseInt(game.white_time_ms) : null,
    black_time_ms: game.black_time_ms ? parseInt(game.black_time_ms) : null,
  };
}

function startQueueCleaner(io) {
  const INTERVAL_MS = 30_000;

  setInterval(async () => {
    const redis = getRedis();
    const all = await redis.lrange(QUEUE_KEY, 0, -1);
    const now = Date.now();

    for (const item of all) {
      let parsed;
      try { parsed = JSON.parse(item); } catch { continue; }

      if (now - parsed.joinedAt >= QUEUE_MAX_AGE_MS) {
        await redis.lrem(QUEUE_KEY, 1, item);
        const sock = io.sockets.sockets.get(parsed.socketId);
        if (sock) {
          sock.emit("queue_expired", { message: "Tempo de espera esgotado. Tente novamente." });
        }
        console.log(`[Matchmaking] removido da fila por TTL: userId=${parsed.userId}`);
      }
    }
  }, INTERVAL_MS);
}

function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
  });

  io.use(verifySocketToken);
  startQueueCleaner(io);

  io.on("connection", (socket) => {
    const { userId } = socket;
    console.log(`[Socket] user=${userId} connected socket=${socket.id}`);

    // Mark user online in Redis (TTL 600s — cleared on disconnect)
    getRedis().set(`online:${userId}`, socket.id, "EX", 600).catch(() => {});

    // Rejoin active game room asynchronously — AFTER listeners are registered
    getUserGame(userId).then(async (activeGameId) => {
      if (!activeGameId) return;
      const game = await getGame(activeGameId);
      if (game && game.status === "active") {
        socket.join(`game:${activeGameId}`);
        await updateSocket(activeGameId, userId, socket.id);
        socket.emit("game_rejoined", buildGameStartPayload(activeGameId, game));
        socket.to(`game:${activeGameId}`).emit("opponent_reconnected");
      }
    }).catch((err) => console.error("[Socket] rejoin error:", err));

    // ── MATCHMAKING ──────────────────────────────────────────────────────
    socket.on("join_queue", async (data = {}) => {
      const meta = typeof data === "object" ? data : {};
      const timeControl = meta.time_control ?? null;
      try {
        const existing = await getUserGame(userId);
        if (existing) {
          const game = await getGame(existing);
          if (game && game.status === "active") {
            socket.emit("error", { message: "Você já está em uma partida" });
            return;
          }
        }

        let opponent = await findOpponent(userId);

        // Skip opponents whose socket disconnected while in the queue
        while (opponent) {
          const opponentSocket = io.sockets.sockets.get(opponent.socketId);
          if (opponentSocket) break;
          console.log(`[Matchmaking] descartando oponente desconectado userId=${opponent.userId}`);
          opponent = await findOpponent(userId);
        }

        if (opponent) {
          const opponentSocket = io.sockets.sockets.get(opponent.socketId);
          const meIsWhite = Math.random() < 0.5;
          const white = meIsWhite
            ? { userId, socketId: socket.id, meta }
            : { userId: opponent.userId, socketId: opponent.socketId, meta: opponent };
          const black = meIsWhite
            ? { userId: opponent.userId, socketId: opponent.socketId, meta: opponent }
            : { userId, socketId: socket.id, meta };

          const gameId = await createGame(white, black, timeControl);
          const game = await getGame(gameId);
          const payload = buildGameStartPayload(gameId, game);

          socket.join(`game:${gameId}`);
          opponentSocket.join(`game:${gameId}`);

          io.to(`game:${gameId}`).emit("game_start", payload);
          console.log(`[Socket] game_start id=${gameId} white=${white.userId} black=${black.userId} tc=${timeControl}`);
        } else {
          await addToQueue(userId, socket.id, meta);
          socket.emit("queued", { message: "Procurando oponente..." });
        }
      } catch (err) {
        console.error("[Socket] join_queue error:", err);
        socket.emit("error", { message: "Erro ao entrar na fila" });
      }
    });

    socket.on("leave_queue", async () => {
      try {
        await removeFromQueue(userId);
        socket.emit("queue_left");
      } catch (err) {
        console.error("[Socket] leave_queue error:", err);
      }
    });

    // ── PRIVATE ROOM ─────────────────────────────────────────────────────
    socket.on("create_room", async (meta = {}) => {
      try {
        const code = await createRoom(userId, socket.id, meta);
        socket.emit("room_created", { code });
      } catch (err) {
        console.error("[Socket] create_room error:", err);
        socket.emit("error", { message: "Erro ao criar sala" });
      }
    });

    socket.on("join_room", async ({ code, meta = {} }) => {
      try {
        if (!code) {
          socket.emit("error", { message: "Código de sala inválido" });
          return;
        }
        const result = await joinRoom(code.toUpperCase(), userId, socket.id, meta);
        if (result.error) {
          socket.emit("error", { message: result.error });
          return;
        }

        const { gameId, white, black } = result;
        const game = await getGame(gameId);
        const payload = buildGameStartPayload(gameId, game);

        socket.join(`game:${gameId}`);

        const creatorSocketId =
          String(white.userId) === String(userId) ? black.socketId : white.socketId;
        const creatorSocket = io.sockets.sockets.get(creatorSocketId);
        if (creatorSocket) creatorSocket.join(`game:${gameId}`);

        io.to(`game:${gameId}`).emit("game_start", payload);
        console.log(`[Socket] game_start (room) id=${gameId}`);
      } catch (err) {
        console.error("[Socket] join_room error:", err);
        socket.emit("error", { message: "Erro ao entrar na sala" });
      }
    });

    // ── GAMEPLAY ─────────────────────────────────────────────────────────
    socket.on("make_move", async ({ game_id, from, to, promotion }) => {
      try {
        if (!game_id || !from || !to) {
          socket.emit("move_error", { message: "Dados de movimento inválidos" });
          return;
        }

        const result = await applyMove(game_id, userId, from, to, promotion);
        if (result.error) {
          socket.emit("move_error", { message: result.error });
          return;
        }

        // Timeout during move check
        if (result.timeout) {
          const winnerId = result.loser === "white" ? result.black_id : result.white_id;
          io.to(`game:${game_id}`).emit("game_over", {
            game_id,
            winner_id: winnerId,
            reason: "timeout",
          });
          reportGameResult(result.white_id, result.black_id, result.loser === "white" ? "black" : "white");
          return;
        }

        io.to(`game:${game_id}`).emit("move_made", {
          game_id,
          ...result,
          white_time_ms: result.white_time_ms,
          black_time_ms: result.black_time_ms,
        });

        if (result.gameOver) {
          const game = await getGame(game_id);
          const winnerId =
            result.gameOver.winner === "white" ? game?.white_id : game?.black_id;

          io.to(`game:${game_id}`).emit("game_over", {
            game_id,
            winner_id: winnerId ?? null,
            reason: result.gameOver.reason,
          });

          if (game) {
            const resultStr = result.gameOver.winner === "white" ? "white"
              : result.gameOver.winner === "black" ? "black"
              : "draw";
            reportGameResult(game.white_id, game.black_id, resultStr);
          }
        }
      } catch (err) {
        console.error("[Socket] make_move error:", err);
        socket.emit("move_error", { message: "Erro interno" });
      }
    });

    socket.on("resign", async ({ game_id }) => {
      try {
        if (!game_id) return;
        const result = await resignGame(game_id, userId);
        if (result.error) {
          socket.emit("error", { message: result.error });
          return;
        }

        const winnerId =
          result.winner === "white" ? result.white_id : result.black_id;
        io.to(`game:${game_id}`).emit("game_over", {
          game_id,
          winner_id: winnerId,
          reason: "resign",
        });

        reportGameResult(result.white_id, result.black_id, result.winner);
      } catch (err) {
        console.error("[Socket] resign error:", err);
      }
    });

    // ── FRIEND INVITE ────────────────────────────────────────────────────
    socket.on("invite_friend", async ({ to_user_id, meta = {} }) => {
      try {
        if (!to_user_id) return;

        // Create room for the inviter
        const code = await createRoom(userId, socket.id, meta);
        socket.emit("room_created", { code });

        // Look up target's active socket via Redis
        const redis = getRedis();
        const targetSocketId = await redis.get(`online:${to_user_id}`);
        if (!targetSocketId) {
          socket.emit("invite_error", { message: "Amigo não está online" });
          return;
        }

        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (!targetSocket) {
          socket.emit("invite_error", { message: "Amigo não está online" });
          return;
        }

        const fromName = meta.username || meta.full_name || `Usuário ${userId}`;
        targetSocket.emit("friend_invitation", {
          from_id: userId,
          from_name: fromName,
          room_code: code,
        });
        console.log(`[Socket] invite_friend from=${userId} to=${to_user_id} code=${code}`);
      } catch (err) {
        console.error("[Socket] invite_friend error:", err);
        socket.emit("error", { message: "Erro ao enviar convite" });
      }
    });

    // ── DISCONNECT ───────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      console.log(`[Socket] user=${userId} disconnected`);
      try {
        getRedis().del(`online:${userId}`).catch(() => {});
        await removeFromQueue(userId);
        const gameId = await getUserGame(userId);
        if (gameId) {
          io.to(`game:${gameId}`).emit("opponent_disconnected", {
            game_id: gameId,
            message: "Oponente desconectou. Aguardando reconexão...",
          });
        }
      } catch (err) {
        console.error("[Socket] disconnect cleanup error:", err);
      }
    });
  });

  return io;
}

module.exports = { setupSocket };
