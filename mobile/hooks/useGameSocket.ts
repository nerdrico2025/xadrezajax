import { useEffect, useRef, useReducer, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { NODE_URL } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import {
  gameSocketReducer,
  initialState,
  type GameColor,
  type PlayerMeta,
} from "./gameSocketReducer";

export type {
  GameColor,
  GamePlayer,
  OnlineGame,
  PlayerMeta,
  RatingOutcome,
  SocketStatus,
  FriendInvitation,
} from "./gameSocketReducer";

/** O que o anfitrião escolhe explicitamente ao convidar um amigo (Item 5):
 *  a cor que ELE joga (o convidado recebe a outra) e o tempo da partida.
 *  Não há opção de "valer rating" — partida humana sempre vale. */
export type HostGameSetup = {
  color: GameColor;
  timeControl: number;
};

// Espelha o TTL do servidor (60s) com folga: expira localmente antes para o
// modal/botão não ficarem pendentes indefinidamente se a resposta nunca chegar.
const DRAW_OFFER_TIMEOUT_MS = 30_000;
const DRAW_DECLINED_BANNER_MS = 4_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseUserId(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return String(payload.user_id ?? "");
  } catch {
    return null;
  }
}

function fenTurn(fen: string): GameColor {
  return (fen.split(" ")[1] as GameColor) ?? "w";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGameSocket() {
  const { token } = useAuth();

  // Refs hold mutable values that don't trigger re-renders.
  // stateRef gives action callbacks always-current state without stale closures.
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef(token);
  const [state, dispatch] = useReducer(gameSocketReducer, initialState);
  const stateRef = useRef(state);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // Socket lifecycle — one effect, one socket per token.
  useEffect(() => {
    if (!token) {
      dispatch({ type: "DISCONNECTED" });
      return;
    }

    dispatch({ type: "CONNECTING" });

    const socket = io(NODE_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1500,
    });

    socket.on("connect", () => dispatch({ type: "CONNECTED" }));

    socket.on("connect_error", (e) =>
      dispatch({ type: "ERROR", error: e.message })
    );

    socket.on("disconnect", () => dispatch({ type: "DISCONNECTED" }));

    socket.io.on("reconnect_attempt", () => dispatch({ type: "RECONNECTING" }));
    socket.io.on("reconnect_failed", () =>
      dispatch({ type: "ERROR", error: "Não foi possível reconectar. Verifique sua conexão." })
    );

    socket.on("queued", () => dispatch({ type: "QUEUED" }));
    socket.on("queue_left", () => dispatch({ type: "QUEUE_LEFT" }));
    socket.on("queue_expired", ({ message }: { message: string }) =>
      dispatch({ type: "ERROR", error: message })
    );

    socket.on("room_created", ({ code }: { code: string }) =>
      dispatch({ type: "ROOM_CREATED", code })
    );

    // Teardown do convite (cancelado pelo criador, recusado pelo convidado ou
    // expirado). Mesmo evento para os dois lados — ver gameRoom.closeRoom.
    socket.on("room_closed", ({ code }: { code: string }) =>
      dispatch({ type: "ROOM_CLOSED", code })
    );

    const handleGameStart = (data: any) => {
      const myId = parseUserId(tokenRef.current ?? "");
      const myColor: GameColor = String(data.white.id) === myId ? "w" : "b";
      dispatch({
        type: "GAME_STARTED",
        game: {
          gameId: data.game_id,
          fen: data.fen,
          white: data.white,
          black: data.black,
          myColor,
          turn: fenTurn(data.fen),
          check: false,
          lastMove: null,
          gameOver: null,
          timeControl: data.time_control ?? null,
          whiteTimeMs: data.white_time_ms ?? null,
          blackTimeMs: data.black_time_ms ?? null,
        },
      });
    };

    socket.on("game_start", handleGameStart);
    socket.on("game_rejoined", handleGameStart);

    socket.on("move_made", (data: any) =>
      dispatch({
        type: "MOVE_MADE",
        fen: data.fen,
        turn: data.turn as GameColor,
        check: !!data.check,
        lastMove: data.move ? { from: data.move.from, to: data.move.to } : null,
        whiteTimeMs: data.white_time_ms ?? null,
        blackTimeMs: data.black_time_ms ?? null,
      })
    );

    socket.on("game_over", (data: any) =>
      dispatch({
        type: "GAME_OVER",
        winnerId: data.winner_id ?? null,
        reason: data.reason,
      })
    );

    // Chega depois do game_over, com o Glicko-2 já aplicado no backend. O
    // servidor manda os dois jogadores no mesmo payload; aqui só extraímos o
    // nosso. Se a chamada ao Django falhar, este evento nunca vem e o modal
    // simplesmente não mostra número — nunca um número inventado.
    socket.on("game_rated", (data: any) => {
      const myId = parseUserId(tokenRef.current ?? "");
      const mine = myId ? data.players?.[myId] : null;
      if (!mine) return;
      dispatch({
        type: "GAME_RATED",
        gameId: data.game_id,
        outcome: {
          rated: data.rated !== false,
          rating: mine.rating,
          ratingBefore: mine.rating_before,
          delta: mine.delta,
          provisional: !!mine.provisional,
        },
      });
    });

    socket.on("opponent_disconnected", () =>
      dispatch({ type: "OPPONENT_DISCONNECTED" })
    );

    socket.on("opponent_reconnected", () =>
      dispatch({ type: "OPPONENT_RECONNECTED" })
    );

    socket.on("draw_offered", () => dispatch({ type: "DRAW_OFFER_RECEIVED" }));

    socket.on("draw_declined", () => dispatch({ type: "DRAW_OFFER_DECLINED" }));

    socket.on("move_error", ({ message }: { message: string }) =>
      dispatch({ type: "MOVE_ERROR", error: message })
    );

    socket.on("error", ({ message, code }: { message: string; code?: string }) =>
      dispatch({ type: "ERROR", error: message, errorCode: code ?? null })
    );

    socket.on("invite_error", ({ message }: { message: string }) =>
      dispatch({ type: "ERROR", error: message })
    );

    socket.on(
      "friend_invitation",
      ({ from_id, from_name, room_code, time_control, your_color }: any) =>
        dispatch({
          type: "FRIEND_INVITATION",
          invitation: {
            fromId: String(from_id),
            fromName: from_name,
            roomCode: room_code,
            // Já decididos pelo anfitrião — o convite só informa.
            timeControl: time_control ?? null,
            yourColor: your_color ?? null,
          },
        })
    );

    socketRef.current = socket;

    return () => {
      socket.io.off("reconnect_attempt");
      socket.io.off("reconnect_failed");
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  // Expiração local das propostas de empate pendentes
  useEffect(() => {
    if (!state.incomingDrawOffer) return;
    const t = setTimeout(
      () => dispatch({ type: "INCOMING_DRAW_CLEARED" }),
      DRAW_OFFER_TIMEOUT_MS
    );
    return () => clearTimeout(t);
  }, [state.incomingDrawOffer]);

  useEffect(() => {
    if (!state.outgoingDrawOffer) return;
    const t = setTimeout(
      () => dispatch({ type: "OUTGOING_DRAW_CLEARED" }),
      DRAW_OFFER_TIMEOUT_MS
    );
    return () => clearTimeout(t);
  }, [state.outgoingDrawOffer]);

  useEffect(() => {
    if (!state.drawOfferDeclined) return;
    const t = setTimeout(
      () => dispatch({ type: "DISMISS_DRAW_DECLINED" }),
      DRAW_DECLINED_BANNER_MS
    );
    return () => clearTimeout(t);
  }, [state.drawOfferDeclined]);

  // ─── Actions ────────────────────────────────────────────────────────────────
  // All callbacks have stable references (empty deps).
  // They read current state via stateRef to avoid stale closures.
  // Guards prevent emitting in wrong states (no duplicate joins, etc.).

  const joinQueue = useCallback((timeControl?: number | null, meta?: PlayerMeta) => {
    const socket = socketRef.current;
    if (!socket?.connected || stateRef.current.status !== "connected") return;
    socket.emit("join_queue", { time_control: timeControl ?? null, ...meta });
  }, []);

  const leaveQueue = useCallback(() => {
    socketRef.current?.emit("leave_queue");
    dispatch({ type: "QUEUE_LEFT" });
  }, []);

  // `meta` é a identidade que o OPONENTE vai ver no topo da tela de jogo. Sem
  // ela o servidor monta o jogador só com o id e a tela cai em "Jogador #N" —
  // era exatamente o que acontecia em sala (a fila rápida já mandava).
  //
  // `setup` é a escolha explícita do anfitrião (cor + tempo). O servidor
  // valida os dois antes de gravar na sala — aqui é sugestão, não decisão.
  const createRoom = useCallback(
    (meta: PlayerMeta = {}, setup?: HostGameSetup) => {
      const socket = socketRef.current;
      if (!socket?.connected || stateRef.current.status !== "connected") return;
      socket.emit("create_room", {
        ...meta,
        color: setup?.color,
        time_control: setup?.timeControl,
      });
    },
    []
  );

  const joinRoom = useCallback((code: string, meta: PlayerMeta = {}) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit("join_room", { code, meta });
  }, []);

  // Passo RECUSAR/SAIR do handshake de convite: invalida a sala no servidor e
  // avisa o outro lado. A limpeza local é otimista (mesmo padrão de
  // leaveQueue/declineDraw) — a tela nunca fica presa esperando o round-trip.
  const closeRoom = useCallback((code: string) => {
    socketRef.current?.emit("close_room", { code });
    dispatch({ type: "ROOM_CLOSED", code });
  }, []);

  // NUNCA descarta um lance em silêncio: em partida ranqueada, um lance que
  // some sem aviso é indistinguível de um bug do tabuleiro. Se não dá para
  // enviar, o jogador é avisado e o tabuleiro é ressincronizado com a posição
  // autoritativa (ver o efeito de `moveError` no OnlineGameScreen).
  const makeMove = useCallback((from: string, to: string, promotion?: string) => {
    const socket = socketRef.current;
    const { game } = stateRef.current;
    if (!game || game.gameOver) return;

    if (!socket?.connected) {
      dispatch({
        type: "MOVE_ERROR",
        error: "Sem conexão — o lance não foi enviado. Tente de novo assim que reconectar.",
      });
      return;
    }

    socket.emit("make_move", { game_id: game.gameId, from, to, promotion });
  }, []);

  const resign = useCallback(() => {
    const socket = socketRef.current;
    const { game } = stateRef.current;
    if (!socket?.connected || !game) return;
    socket.emit("resign", { game_id: game.gameId });
  }, []);

  const offerDraw = useCallback(() => {
    const socket = socketRef.current;
    const { game, outgoingDrawOffer } = stateRef.current;
    if (!socket?.connected || !game || game.gameOver || outgoingDrawOffer) return;
    socket.emit("offer_draw", { game_id: game.gameId });
    dispatch({ type: "DRAW_OFFER_SENT" });
  }, []);

  const acceptDraw = useCallback(() => {
    const socket = socketRef.current;
    const { game, incomingDrawOffer } = stateRef.current;
    if (!socket?.connected || !game || !incomingDrawOffer) return;
    socket.emit("accept_draw", { game_id: game.gameId });
    dispatch({ type: "INCOMING_DRAW_CLEARED" });
  }, []);

  const declineDraw = useCallback(() => {
    const socket = socketRef.current;
    const { game, incomingDrawOffer } = stateRef.current;
    if (!incomingDrawOffer) return;
    if (socket?.connected && game) {
      socket.emit("decline_draw", { game_id: game.gameId });
    }
    dispatch({ type: "INCOMING_DRAW_CLEARED" });
  }, []);

  const clearGame = useCallback(() => {
    dispatch({ type: "CLEAR_GAME", connected: socketRef.current?.connected ?? false });
  }, []);

  const inviteFriend = useCallback(
    (toUserId: number, meta: PlayerMeta = {}, setup?: HostGameSetup) => {
      socketRef.current?.emit("invite_friend", {
        to_user_id: toUserId,
        meta: { ...meta, color: setup?.color, time_control: setup?.timeControl },
      });
    },
    []
  );

  const dismissInvitation = useCallback(() => {
    dispatch({ type: "DISMISS_INVITATION" });
  }, []);

  return {
    status: state.status,
    game: state.game,
    error: state.error,
    errorCode: state.errorCode,
    errorSeq: state.errorSeq,
    roomCode: state.roomCode,
    opponentDisconnected: state.opponentDisconnected,
    friendInvitation: state.friendInvitation,
    incomingDrawOffer: state.incomingDrawOffer,
    outgoingDrawOffer: state.outgoingDrawOffer,
    drawOfferDeclined: state.drawOfferDeclined,
    ratingOutcome: state.ratingOutcome,
    joinQueue,
    leaveQueue,
    createRoom,
    joinRoom,
    closeRoom,
    makeMove,
    resign,
    offerDraw,
    acceptDraw,
    declineDraw,
    clearGame,
    inviteFriend,
    dismissInvitation,
  };
}
