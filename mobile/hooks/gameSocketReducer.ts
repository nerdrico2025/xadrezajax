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

export type FriendInvitation = {
  fromId: string;
  fromName: string;
  roomCode: string;
};

// ─── State machine ────────────────────────────────────────────────────────────

export type State = {
  status: SocketStatus;
  game: OnlineGame | null;
  error: string | null;
  // Código de erro mapeável pela UI (ex.: daily_limit_reached → tela de
  // upgrade), quando o servidor envia um junto da mensagem
  errorCode: string | null;
  roomCode: string | null;
  opponentDisconnected: boolean;
  friendInvitation: FriendInvitation | null;
  incomingDrawOffer: boolean;
  outgoingDrawOffer: boolean;
  drawOfferDeclined: boolean;
};

export type Action =
  | { type: "CONNECTING" }
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "RECONNECTING" }
  | { type: "ERROR"; error: string; errorCode?: string | null }
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
  | { type: "DISMISS_INVITATION" }
  | { type: "DRAW_OFFER_RECEIVED" }
  | { type: "DRAW_OFFER_SENT" }
  | { type: "DRAW_OFFER_DECLINED" }
  | { type: "INCOMING_DRAW_CLEARED" }
  | { type: "OUTGOING_DRAW_CLEARED" }
  | { type: "DISMISS_DRAW_DECLINED" };

export const initialState: State = {
  status: "idle",
  game: null,
  error: null,
  errorCode: null,
  roomCode: null,
  opponentDisconnected: false,
  friendInvitation: null,
  incomingDrawOffer: false,
  outgoingDrawOffer: false,
  drawOfferDeclined: false,
};

const noDrawOffers = {
  incomingDrawOffer: false,
  outgoingDrawOffer: false,
  drawOfferDeclined: false,
};

export function gameSocketReducer(state: State, action: Action): State {
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
      return {
        ...state,
        status: "error",
        error: action.error,
        errorCode: action.errorCode ?? null,
      };
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
        ...noDrawOffers,
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
        ...noDrawOffers,
      };
    case "OPPONENT_DISCONNECTED":
      // Proposta pendente expira — não deixa modal/botão travado esperando
      // resposta de quem caiu
      return { ...state, opponentDisconnected: true, ...noDrawOffers };
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
        ...noDrawOffers,
      };
    case "FRIEND_INVITATION":
      return { ...state, friendInvitation: action.invitation };
    case "DISMISS_INVITATION":
      return { ...state, friendInvitation: null };
    case "DRAW_OFFER_RECEIVED":
      if (!state.game || state.game.gameOver) return state;
      return { ...state, incomingDrawOffer: true };
    case "DRAW_OFFER_SENT":
      if (!state.game || state.game.gameOver) return state;
      return { ...state, outgoingDrawOffer: true, drawOfferDeclined: false };
    case "DRAW_OFFER_DECLINED":
      return { ...state, outgoingDrawOffer: false, drawOfferDeclined: true };
    case "INCOMING_DRAW_CLEARED":
      return { ...state, incomingDrawOffer: false };
    case "OUTGOING_DRAW_CLEARED":
      return { ...state, outgoingDrawOffer: false };
    case "DISMISS_DRAW_DECLINED":
      return { ...state, drawOfferDeclined: false };
    default:
      return state;
  }
}
