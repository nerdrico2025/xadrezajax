import {
  gameSocketReducer,
  initialState,
  type OnlineGame,
  type State,
} from "../gameSocketReducer";

const GAME: OnlineGame = {
  gameId: "G1",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  white: { id: "1" },
  black: { id: "2" },
  myColor: "w",
  turn: "w",
  check: false,
  lastMove: null,
  gameOver: null,
  timeControl: null,
  whiteTimeMs: null,
  blackTimeMs: null,
};

function inGame(): State {
  return gameSocketReducer(
    { ...initialState, status: "connected" },
    { type: "GAME_STARTED", game: GAME }
  );
}

describe("fluxo de proposta de empate no gameSocketReducer", () => {
  it("começa sem proposta pendente", () => {
    const state = inGame();
    expect(state.incomingDrawOffer).toBe(false);
    expect(state.outgoingDrawOffer).toBe(false);
    expect(state.drawOfferDeclined).toBe(false);
  });

  it("registra proposta enviada e proposta recebida", () => {
    let state = inGame();
    state = gameSocketReducer(state, { type: "DRAW_OFFER_SENT" });
    expect(state.outgoingDrawOffer).toBe(true);

    state = gameSocketReducer(state, { type: "DRAW_OFFER_RECEIVED" });
    expect(state.incomingDrawOffer).toBe(true);
  });

  it("ignora proposta recebida sem partida ativa ou com partida encerrada", () => {
    expect(
      gameSocketReducer(initialState, { type: "DRAW_OFFER_RECEIVED" })
        .incomingDrawOffer
    ).toBe(false);

    let state = inGame();
    state = gameSocketReducer(state, {
      type: "GAME_OVER",
      winnerId: "1",
      reason: "checkmate",
    });
    state = gameSocketReducer(state, { type: "DRAW_OFFER_RECEIVED" });
    expect(state.incomingDrawOffer).toBe(false);
  });

  it("recusa do oponente limpa a proposta enviada e sinaliza o banner", () => {
    let state = inGame();
    state = gameSocketReducer(state, { type: "DRAW_OFFER_SENT" });
    state = gameSocketReducer(state, { type: "DRAW_OFFER_DECLINED" });

    expect(state.outgoingDrawOffer).toBe(false);
    expect(state.drawOfferDeclined).toBe(true);

    state = gameSocketReducer(state, { type: "DISMISS_DRAW_DECLINED" });
    expect(state.drawOfferDeclined).toBe(false);
  });

  it("nova proposta enviada limpa o aviso de recusa anterior", () => {
    let state = inGame();
    state = gameSocketReducer(state, { type: "DRAW_OFFER_SENT" });
    state = gameSocketReducer(state, { type: "DRAW_OFFER_DECLINED" });
    state = gameSocketReducer(state, { type: "DRAW_OFFER_SENT" });

    expect(state.outgoingDrawOffer).toBe(true);
    expect(state.drawOfferDeclined).toBe(false);
  });

  it("expiração local limpa cada direção separadamente", () => {
    let state = inGame();
    state = gameSocketReducer(state, { type: "DRAW_OFFER_SENT" });
    state = gameSocketReducer(state, { type: "DRAW_OFFER_RECEIVED" });

    state = gameSocketReducer(state, { type: "INCOMING_DRAW_CLEARED" });
    expect(state.incomingDrawOffer).toBe(false);
    expect(state.outgoingDrawOffer).toBe(true);

    state = gameSocketReducer(state, { type: "OUTGOING_DRAW_CLEARED" });
    expect(state.outgoingDrawOffer).toBe(false);
  });

  it("fim de jogo (empate aceito) limpa qualquer proposta pendente", () => {
    let state = inGame();
    state = gameSocketReducer(state, { type: "DRAW_OFFER_SENT" });
    state = gameSocketReducer(state, {
      type: "GAME_OVER",
      winnerId: null,
      reason: "agreement",
    });

    expect(state.game?.gameOver).toEqual({ winnerId: null, reason: "agreement" });
    expect(state.outgoingDrawOffer).toBe(false);
    expect(state.incomingDrawOffer).toBe(false);
  });

  it("desconexão do oponente expira a proposta pendente (não trava o fluxo)", () => {
    let state = inGame();
    state = gameSocketReducer(state, { type: "DRAW_OFFER_RECEIVED" });
    state = gameSocketReducer(state, { type: "OPPONENT_DISCONNECTED" });

    expect(state.opponentDisconnected).toBe(true);
    expect(state.incomingDrawOffer).toBe(false);
    expect(state.outgoingDrawOffer).toBe(false);
  });

  it("erro do servidor com código fica mapeável pela UI (ex.: limite diário)", () => {
    let state = gameSocketReducer(
      { ...initialState, status: "connected" },
      {
        type: "ERROR",
        error: "Limite diário de partidas do plano Grátis atingido.",
        errorCode: "daily_limit_reached",
      }
    );
    expect(state.status).toBe("error");
    expect(state.errorCode).toBe("daily_limit_reached");

    // Erro sem código (ex.: conexão) não carrega código antigo
    state = gameSocketReducer(state, { type: "ERROR", error: "outro" });
    expect(state.errorCode).toBeNull();
  });

  it("nova partida (inclusive rejoin) começa sem propostas pendentes", () => {
    let state = inGame();
    state = gameSocketReducer(state, { type: "DRAW_OFFER_SENT" });
    state = gameSocketReducer(state, { type: "GAME_STARTED", game: GAME });

    expect(state.outgoingDrawOffer).toBe(false);
    expect(state.incomingDrawOffer).toBe(false);
  });
});

// ── Teardown do convite (ROOM_CLOSED) ────────────────────────────────────
// Mesmo evento fecha os dois lados: quem hospeda a sala e quem recebeu o
// convite. Ver gameRoom.closeRoom no node-api.

describe("teardown de sala/convite no gameSocketReducer", () => {
  const INVITATION = { fromId: "9", fromName: "Renan", roomCode: "ABC123" };

  function hosting(code = "ABC123"): State {
    return gameSocketReducer(
      { ...initialState, status: "connected" },
      { type: "ROOM_CREATED", code }
    );
  }

  it("quem hospeda: limpa o código e sai do estado de espera", () => {
    let state = hosting();
    expect(state.roomCode).toBe("ABC123");
    expect(state.status).toBe("queued");

    state = gameSocketReducer(state, { type: "ROOM_CLOSED", code: "ABC123" });
    expect(state.roomCode).toBeNull();
    expect(state.status).toBe("connected");
  });

  it("quem foi convidado: some com o convite da tela", () => {
    let state = gameSocketReducer(
      { ...initialState, status: "connected" },
      { type: "FRIEND_INVITATION", invitation: INVITATION }
    );
    expect(state.friendInvitation).not.toBeNull();

    state = gameSocketReducer(state, { type: "ROOM_CLOSED", code: "ABC123" });
    expect(state.friendInvitation).toBeNull();
  });

  it("ignora teardown de outra sala — não apaga convite novo", () => {
    let state = gameSocketReducer(
      hosting("NOVA01"),
      { type: "FRIEND_INVITATION", invitation: INVITATION }
    );

    state = gameSocketReducer(state, { type: "ROOM_CLOSED", code: "VELHA0" });
    expect(state.roomCode).toBe("NOVA01");
    expect(state.friendInvitation).toEqual(INVITATION);
  });

  it("não derruba partida em andamento", () => {
    let state = inGame();
    state = gameSocketReducer(state, { type: "ROOM_CLOSED", code: "ABC123" });
    expect(state.status).toBe("in_game");
    expect(state.game).not.toBeNull();
  });
});
