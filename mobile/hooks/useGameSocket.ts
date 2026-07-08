import { useEffect, useRef, useReducer, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { NODE_URL } from "@/services/api";
import { useAuth } from "@/context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GameColor = "w" | "b";

export type GamePlayer = {
  id: string;
  username?: string;
  rating?: number;
};

export type OnlineGame = {
  gameId: string;
  fen: string;
  white: GamePlayer;
  black: GamePlayer;
  myColor: GameColor;
  turn: GameColor;
  check: boolean;
  lastMove: { from: string; to: string } | null;
  gameOver: { winnerId: string | null; reason: string } | null;
  timeControl: number | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
};

export type SocketStatus =
  | "idle"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "queued"
  | "in_game"
  | "error";

// ─── State machine ────────────────────────────────────────────────────────────

export type FriendInvitation = {
  fromId: string;
  fromName: string;
  roomCode: string;
};

type State = {
  status: SocketStatus;
  game: OnlineGame | null;
  error: string | null;
  roomCode: string | null;
  opponentDisconnected: boolean;
  friendInvitation: FriendInvitation | null;
};

type Action =
  | { type: "CONNECTING" }
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "RECONNECTING" }
  | { type: "ERROR"; error: string }
  | { type: "QUEUED" }
  | { type: "QUEUE_LEFT" }
  | { type: "ROOM_CREATED"; code: string }
  | { type: "GAME_STARTED"; game: OnlineGame }
  | { type: "MOVE_MADE"; fen: string; turn: GameColor; check: boolean; lastMove: { from: string; to: string } | null; whiteTimeMs: number | null; blackTimeMs: number | null }
  | { type: "GAME_OVER"; winnerId: string | null; reason: string }
  | { type: "OPPONENT_DISCONNECTED" }
  | { type: "MOVE_ERROR"; error: string }
  | { type: "OPPONENT_RECONNECTED" }
  | { type: "CLEAR_GAME"; connected: boolean }
  | { type: "FRIEND_INVITATION"; invitation: FriendInvitation }
  | { type: "DISMISS_INVITATION" };

const initialState: State = {
  status: "idle",
  game: null,
  error: null,
  roomCode: null,
  opponentDisconnected: false,
  friendInvitation: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CONNECTING":
      return { ...initialState, status: "connecting" };
    case "CONNECTED":
      return { ...state, status: "connected", error: null };
    case "DISCONNECTED":
      // Se havia partida ativa, mantém o game e vai para reconnecting
      return state.game && state.status === "in_game"
        ? { ...state, status: "reconnecting" }
        : { ...state, status: "idle" };
    case "RECONNECTING":
      return { ...state, status: "reconnecting" };
    case "ERROR":
      return { ...state, status: "error", error: action.error };
    case "QUEUED":
      return { ...state, status: "queued" };
    case "QUEUE_LEFT":
      return { ...state, status: "connected", roomCode: null };
    case "ROOM_CREATED":
      return { ...state, status: "queued", roomCode: action.code };
    case "GAME_STARTED":
      return {
        ...state,
        status: "in_game",
        game: action.game,
        roomCode: null,
        opponentDisconnected: false,
        error: null,
      };
    case "MOVE_MADE":
      if (!state.game) return state;
      return {
        ...state,
        game: {
          ...state.game,
          fen: action.fen,
          turn: action.turn,
          check: action.check,
          lastMove: action.lastMove,
          whiteTimeMs: action.whiteTimeMs ?? state.game.whiteTimeMs,
          blackTimeMs: action.blackTimeMs ?? state.game.blackTimeMs,
        },
      };
    case "GAME_OVER":
      if (!state.game) return state;
      return {
        ...state,
        game: {
          ...state.game,
          gameOver: { winnerId: action.winnerId, reason: action.reason },
        },
      };
    case "OPPONENT_DISCONNECTED":
      return { ...state, opponentDisconnected: true };
    case "OPPONENT_RECONNECTED":
      return { ...state, opponentDisconnected: false };
    case "MOVE_ERROR":
      return { ...state, error: action.error };
    case "CLEAR_GAME":
      return {
        ...state,
        game: null,
        opponentDisconnected: false,
        status: action.connected ? "connected" : "idle",
        error: null,
      };
    case "FRIEND_INVITATION":
      return { ...state, friendInvitation: action.invitation };
    case "DISMISS_INVITATION":
      return { ...state, friendInvitation: null };
    default:
      return state;
  }
}

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
  const [state, dispatch] = useReducer(reducer, initialState);
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
    joinQueue,
    leaveQueue,
    createRoom,
    joinRoom,
    makeMove,
    resign,
    clearGame,
    inviteFriend,
    dismissInvitation,
  };
}
