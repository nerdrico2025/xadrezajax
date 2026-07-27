// ─── Types ────────────────────────────────────────────────────────────────────

export type GameColor = "w" | "b";

export type GamePlayer = {
  id: string;
  username?: string;
  full_name?: string;
  rating?: number;
};

/** Identidade que o jogador anuncia ao entrar numa fila ou sala — é o que a
 * tela de jogo do oponente exibe no topo. */
export type PlayerMeta = {
  username?: string | null;
  full_name?: string | null;
  rating?: number | null;
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
  | { type: "ROOM_CLOSED"; code: string }
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
      // Reconectar NÃO pode rebaixar uma partida ativa. `makeMove` só envia
      // em "in_game"; enquanto este case devolvia "connected" incondicional,
      // todo lance depois de uma queda era descartado até chegar o
      // `game_rejoined` — que podia nunca chegar se o ponteiro de recuperação
      // já tivesse expirado no servidor.
      return {
        ...state,
        status: state.game && !state.game.gameOver ? "in_game" : "connected",
        error: null,
      };
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
    case "ROOM_CLOSED": {
      // Fecha o convite dos DOIS lados com o mesmo evento: quem esperava na
      // sala (roomCode) e quem tinha o convite na tela (friendInvitation).
      // Ignora códigos de outra sala — evita que um teardown atrasado apague
      // um convite novo.
      const wasHosting = state.roomCode === action.code;
      const wasInvited = state.friendInvitation?.roomCode === action.code;
      if (!wasHosting && !wasInvited) return state;
      return {
        ...state,
        roomCode: wasHosting ? null : state.roomCode,
        friendInvitation: wasInvited ? null : state.friendInvitation,
        // "queued" aqui é o estado de espera criado pelo ROOM_CREATED —
        // volta para conectado. Partida em andamento nunca é afetada.
        status:
          wasHosting && state.status === "queued" ? "connected" : state.status,
      };
    }
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
