import { useEffect, useRef, useReducer, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { NODE_URL } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import {
  gameSocketReducer,
  initialState,
  type GameColor,
} from "./gameSocketReducer";

export type {
  GameColor,
  GamePlayer,
  OnlineGame,
  SocketStatus,
  FriendInvitation,
} from "./gameSocketReducer";

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

    socket.on("error", ({ message }: { message: string }) =>
      dispatch({ type: "ERROR", error: message })
    );

    socket.on("invite_error", ({ message }: { message: string }) =>
      dispatch({ type: "ERROR", error: message })
    );

    socket.on("friend_invitation", ({ from_id, from_name, room_code }: any) =>
      dispatch({
        type: "FRIEND_INVITATION",
        invitation: { fromId: String(from_id), fromName: from_name, roomCode: room_code },
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

  const joinQueue = useCallback((timeControl?: number | null, meta?: { username?: string | null; rating?: number | null }) => {
    const socket = socketRef.current;
    if (!socket?.connected || stateRef.current.status !== "connected") return;
    socket.emit("join_queue", { time_control: timeControl ?? null, ...meta });
  }, []);

  const leaveQueue = useCallback(() => {
    socketRef.current?.emit("leave_queue");
    dispatch({ type: "QUEUE_LEFT" });
  }, []);

  const createRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || stateRef.current.status !== "connected") return;
    socket.emit("create_room");
  }, []);

  const joinRoom = useCallback((code: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit("join_room", { code });
  }, []);

  const makeMove = useCallback((from: string, to: string, promotion?: string) => {
    const socket = socketRef.current;
    const { game, status } = stateRef.current;
    if (!socket || !game || status !== "in_game") return;
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
    (toUserId: number, meta: { username?: string | null; full_name?: string } = {}) => {
      socketRef.current?.emit("invite_friend", { to_user_id: toUserId, meta });
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
    roomCode: state.roomCode,
    opponentDisconnected: state.opponentDisconnected,
    friendInvitation: state.friendInvitation,
    incomingDrawOffer: state.incomingDrawOffer,
    outgoingDrawOffer: state.outgoingDrawOffer,
    drawOfferDeclined: state.drawOfferDeclined,
    joinQueue,
    leaveQueue,
    createRoom,
    joinRoom,
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
