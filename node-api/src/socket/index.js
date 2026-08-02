const { Server } = require("socket.io");
const { getRedis } = require("../services/redis.service");
const { verifySocketToken } = require("./auth");
const { addToQueue, removeFromQueue, findOpponent, getUserGame, renewUserGame, QUEUE_KEY, QUEUE_MAX_AGE_MS } = require("./matchmaking");
const {
  reportGameResult,
  canPlayGame,
  getColorBalance,
} = require("../services/gameResult.service");
const {
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
  abandonGraceMs,
  resolveHumanTimeControl,
} = require("./gameRoom");
const { decideFirstPlaysWhite } = require("./colorBalance");

// Timers de carência por abandono, por usuário desconectado. Cancelados
// assim que o jogador reconecta. Processo único por design (o node-api roda
// numa instância só); se um dia escalar, a defesa contra encerramento
// duplicado continua sendo `resignGame`, que recusa partida já encerrada.
const abandonTimers = new Map();

function clearAbandonTimer(userId) {
  const key = String(userId);
  const timer = abandonTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    abandonTimers.delete(key);
  }
}

/**
 * Reporta o resultado ao Django e devolve aos DOIS jogadores o que o rating
 * fez (Item 2). O app nunca calcula delta — quem rateia é o servidor.
 *
 * Emitido DEPOIS do `game_over`, num evento separado, de propósito: o modal
 * de fim de partida não pode esperar um round-trip HTTP para aparecer. Ele
 * abre na hora e completa com o delta quando ele chega. Se a chamada falhar
 * (backend fora), nenhum evento é emitido e o modal só não mostra o número —
 * nunca mostra um número errado.
 */
async function reportAndBroadcastRating(io, gameId, whiteId, blackId, result, timeControl) {
  const data = await reportGameResult(whiteId, blackId, result, timeControl);
  if (!data) return;

  io.to(`game:${gameId}`).emit("game_rated", {
    game_id: gameId,
    rated: data.rated !== false,
    modality: data.modality ?? null,
    players: {
      [String(whiteId)]: {
        rating: data.white.rating,
        rating_before: data.white.rating_before,
        delta: data.white.delta,
        provisional: data.white.provisional,
      },
      [String(blackId)]: {
        rating: data.black.rating,
        rating_before: data.black.rating_before,
        delta: data.black.delta,
        provisional: data.black.provisional,
      },
    },
  });
}

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

    // Voltou dentro da carência: a partida não é encerrada por abandono.
    clearAbandonTimer(userId);

    // Rejoin active game room asynchronously — AFTER listeners are registered
    getUserGame(userId).then(async (activeGameId) => {
      if (!activeGameId) return;
      const game = await getGame(activeGameId);
      if (game && game.status === "active") {
        socket.join(`game:${activeGameId}`);
        await updateSocket(activeGameId, userId, socket.id);
        // Reconectar renova o ponteiro de recuperação — quem passou por uma
        // queda é justamente quem mais precisa que ele sobreviva.
        await renewUserGame(userId);
        socket.emit("game_rejoined", buildGameStartPayload(activeGameId, game));
        socket.to(`game:${activeGameId}`).emit("opponent_reconnected");
      }
    }).catch((err) => console.error("[Socket] rejoin error:", err));

    // ── MATCHMAKING ──────────────────────────────────────────────────────
    socket.on("join_queue", async (data = {}) => {
      const meta = typeof data === "object" ? data : {};
      // Tempo pedido pelo cliente = preferência salva em Ajustes. Só entra se
      // estiver na lista de tempos humanos; qualquer outra coisa vira o
      // default. A busca rápida continua sendo UM TOQUE — nada é perguntado
      // aqui, e não há toggle de "valer rating" (partida humana sempre vale).
      const requestedTimeControl = resolveHumanTimeControl(meta.time_control);
      try {
        const existing = await getUserGame(userId);
        if (existing) {
          const game = await getGame(existing);
          if (game && game.status === "active") {
            socket.emit("error", { message: "Você já está em uma partida" });
            return;
          }
        }

        // Gating do plano Grátis (RF-MON-05): bloqueia ANTES de entrar na
        // fila — nunca depois do pareamento. Salas privadas (não-rateadas)
        // não passam por aqui e seguem livres.
        const access = await canPlayGame(userId);
        if (access.can_play === false) {
          socket.emit("error", {
            message:
              "Limite diário de partidas do plano Grátis atingido. " +
              "Assine o Premium para jogar sem limites.",
            code: "daily_limit_reached",
          });
          return;
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

          // Vale o tempo de quem JÁ ESTAVA na fila, não o de quem acabou de
          // chegar. Com um só pareamento possível entre duas preferências
          // diferentes, alguém tem que ceder; quem esperou mais tempo é o
          // critério menos arbitrário — e é determinístico, decidido no
          // servidor. (Filas separadas por tempo seriam o "certo" de um app
          // grande, mas com a base atual ninguém pareava.)
          const timeControl = resolveHumanTimeControl(
            opponent.time_control ?? requestedTimeControl
          );

          // Cor balanceada pelo histórico do PAR, não sorteada por partida.
          const balance = await getColorBalance([userId, opponent.userId]);
          const meIsWhite = decideFirstPlaysWhite(balance, userId, opponent.userId);

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
          console.log(
            `[Socket] game_start id=${gameId} white=${white.userId} ` +
              `black=${black.userId} tc=${timeControl} ` +
              `cor=${balance ? "balanceada" : "sorteada"}`
          );
        } else {
          // O tempo pedido viaja com a entrada na fila: é ele que vale quando
          // alguém parear com este jogador (ver acima).
          await addToQueue(userId, socket.id, {
            ...meta,
            time_control: requestedTimeControl,
          });
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
    // `meta.color` e `meta.time_control` são a escolha explícita do anfitrião
    // (Item 5). Normalizados dentro do createRoom — o cliente sugere, o
    // servidor decide. Não há opção de "valer rating": partida humana sempre
    // vale, e "amistosa" deixou de existir como categoria.
    socket.on("create_room", async (meta = {}) => {
      try {
        const code = await createRoom(userId, socket.id, meta, {
          hostColor: meta.color,
          timeControl: meta.time_control,
        });
        socket.emit("room_created", { code });
      } catch (err) {
        console.error("[Socket] create_room error:", err);
        socket.emit("error", { message: "Erro ao criar sala" });
      }
    });

    // Teardown do convite — passo RECUSAR/SAIR do handshake (ver
    // gameRoom.closeRoom). Um único par de eventos (close_room → room_closed)
    // serve ao criador que cancela e ao convidado que recusa; o `reason` é
    // derivado do papel no servidor, nunca aceito do cliente.
    socket.on("close_room", async ({ code } = {}) => {
      try {
        if (!code) return;
        const normalized = String(code).toUpperCase();
        const result = await closeRoom(normalized, userId);
        if (result.error) {
          socket.emit("error", { message: result.error });
          return;
        }

        const payload = {
          code: normalized,
          reason: result.reason,
          by_id: String(userId),
        };

        // Quem fechou sempre recebe a confirmação — inclusive quando a sala
        // já tinha expirado. É o que destrava a tela dele sem depender do
        // estado do Redis.
        socket.emit("room_closed", payload);

        if (result.notifyUserId) {
          const targetSocketId = await getRedis().get(
            `online:${result.notifyUserId}`
          );
          const targetSocket =
            targetSocketId && io.sockets.sockets.get(targetSocketId);
          if (targetSocket) targetSocket.emit("room_closed", payload);
        }

        console.log(
          `[Socket] room_closed code=${normalized} reason=${result.reason} by=${userId}`
        );
      } catch (err) {
        console.error("[Socket] close_room error:", err);
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
          reportAndBroadcastRating(
            io,
            game_id,
            result.white_id,
            result.black_id,
            result.loser === "white" ? "black" : "white",
            result.time_control
          );
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
            reportAndBroadcastRating(
              io,
              game_id,
              game.white_id,
              game.black_id,
              resultStr,
              game.time_control ? parseInt(game.time_control) : null
            );
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

        reportAndBroadcastRating(
          io,
          game_id,
          result.white_id,
          result.black_id,
          result.winner,
          result.time_control
        );
      } catch (err) {
        console.error("[Socket] resign error:", err);
      }
    });

    socket.on("offer_draw", async ({ game_id }) => {
      try {
        if (!game_id) return;
        const result = await offerDraw(game_id, userId);
        if (result.error) {
          socket.emit("error", { message: result.error });
          return;
        }

        // Só o oponente recebe a proposta (socket.to exclui o remetente)
        socket.to(`game:${game_id}`).emit("draw_offered", {
          game_id,
          from_id: String(userId),
        });
        console.log(`[Socket] draw_offered game=${game_id} from=${userId}`);
      } catch (err) {
        console.error("[Socket] offer_draw error:", err);
      }
    });

    socket.on("accept_draw", async ({ game_id }) => {
      try {
        if (!game_id) return;
        const result = await acceptDraw(game_id, userId);
        if (result.error) {
          socket.emit("error", { message: result.error });
          return;
        }

        io.to(`game:${game_id}`).emit("game_over", {
          game_id,
          winner_id: null,
          reason: "agreement",
        });

        reportAndBroadcastRating(
          io,
          game_id,
          result.white_id,
          result.black_id,
          "draw",
          result.time_control
        );
        console.log(`[Socket] draw accepted game=${game_id} by=${userId}`);
      } catch (err) {
        console.error("[Socket] accept_draw error:", err);
      }
    });

    socket.on("decline_draw", async ({ game_id }) => {
      try {
        if (!game_id) return;
        const result = await declineDraw(game_id, userId);
        if (result.error) return;

        socket.to(`game:${game_id}`).emit("draw_declined", {
          game_id,
          declined_by: String(userId),
        });
        console.log(`[Socket] draw declined game=${game_id} by=${userId}`);
      } catch (err) {
        console.error("[Socket] decline_draw error:", err);
      }
    });

    // ── FRIEND INVITE ────────────────────────────────────────────────────
    socket.on("invite_friend", async ({ to_user_id, meta = {} }) => {
      try {
        if (!to_user_id) return;

        // Resolve o destinatário ANTES de criar a sala: criar primeiro
        // deixava sala órfã no Redis (10 min) sempre que o amigo estava
        // offline, e a tela de quem convidou travava em "aguardando entrar".
        const redis = getRedis();
        const targetSocketId = await redis.get(`online:${to_user_id}`);
        const targetSocket =
          targetSocketId && io.sockets.sockets.get(targetSocketId);
        if (!targetSocket) {
          socket.emit("invite_error", { message: "Amigo não está online" });
          return;
        }

        // `inviteeId` fica gravado na sala para que o teardown (close_room)
        // saiba a quem avisar se o convite for cancelado — sem isso o
        // convidado ficaria com o convite válido na tela e ainda conseguiria
        // entrar numa sala já abandonada.
        const code = await createRoom(userId, socket.id, meta, {
          inviteeId: to_user_id,
          // Escolha explícita do anfitrião no convite (Item 5): ele pega
          // brancas ou pretas, o convidado recebe a outra.
          hostColor: meta.color,
          timeControl: meta.time_control,
        });

        // Corrida estreita: o amigo pode cair entre a checagem e o envio.
        // Desfaz a sala pelo mesmo teardown da #85 em vez de deixá-la órfã.
        if (!targetSocket.connected) {
          await closeRoom(code, userId);
          socket.emit("invite_error", { message: "Amigo não está online" });
          return;
        }

        socket.emit("room_created", { code });

        const fromName = meta.username || meta.full_name || `Usuário ${userId}`;
        const room = await getRedis().hgetall(`room:${code}`);
        targetSocket.emit("friend_invitation", {
          from_id: userId,
          from_name: fromName,
          room_code: code,
          // O convite diz ao convidado o que já foi decidido: quanto tempo e
          // que cor sobrou para ele (o inverso da escolha do anfitrião). Vem
          // da sala, já normalizado — não do que o convidante mandou.
          time_control: room.time_control ? parseInt(room.time_control) : null,
          your_color: room.host_color === "w" ? "b" : room.host_color === "b" ? "w" : null,
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
        if (!gameId) return;

        const game = await getGame(gameId);
        if (!game || game.status !== "active") return;

        // Carência para reconectar. Esgotada, a partida encerra com derrota
        // por abandono — com "toda partida humana vale rating", fechar o app
        // não pode ser rota de fuga para quem está perdendo. O limite é do
        // servidor e nunca excede o relógio de quem caiu (ver abandonGraceMs).
        const graceMs = abandonGraceMs(game, userId);

        io.to(`game:${gameId}`).emit("opponent_disconnected", {
          game_id: gameId,
          message: "Oponente desconectou. Aguardando reconexão...",
          grace_ms: graceMs,
        });

        clearAbandonTimer(userId);
        abandonTimers.set(
          String(userId),
          setTimeout(async () => {
            abandonTimers.delete(String(userId));
            try {
              // Mesma via de encerramento da desistência — quem sai da
              // partida perde, tenha clicado em "Desistir" ou sumido.
              // `resignGame` recusa partida já encerrada, então uma corrida
              // com outro fim de jogo não gera resultado duplicado.
              const result = await resignGame(gameId, userId);
              if (result.error) return;

              const winnerId =
                result.winner === "white" ? result.white_id : result.black_id;
              io.to(`game:${gameId}`).emit("game_over", {
                game_id: gameId,
                winner_id: winnerId,
                reason: "abandon",
              });
              reportAndBroadcastRating(
                io,
                gameId,
                result.white_id,
                result.black_id,
                result.winner,
                result.time_control
              );
              console.log(
                `[Socket] abandono game=${gameId} por=${userId} apos=${graceMs}ms`
              );
            } catch (err) {
              console.error("[Socket] abandon error:", err);
            }
          }, graceMs)
        );
      } catch (err) {
        console.error("[Socket] disconnect cleanup error:", err);
      }
    });
  });

  return io;
}

module.exports = { setupSocket };
