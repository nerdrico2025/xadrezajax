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

// O delta de rating chega DEPOIS do game_over, num evento próprio: o modal de
// fim de partida abre na hora e completa quando o Glicko-2 volta do servidor.
describe("GAME_RATED — delta de rating da partida", () => {
  const OUTCOME = {
    rated: true,
    rating: 1512,
    ratingBefore: 1500,
    delta: 12,
    provisional: false,
  };

  it("partida nova começa sem resultado de rating", () => {
    expect(inGame().ratingOutcome).toBeNull();
  });

  it("guarda o resultado da partida corrente", () => {
    const state = gameSocketReducer(inGame(), {
      type: "GAME_RATED",
      gameId: "G1",
      outcome: OUTCOME,
    });
    expect(state.ratingOutcome).toEqual(OUTCOME);
  });

  it("ignora resultado de OUTRA partida — um evento atrasado não pinta a revanche", () => {
    const state = gameSocketReducer(inGame(), {
      type: "GAME_RATED",
      gameId: "PARTIDA-ANTIGA",
      outcome: OUTCOME,
    });
    expect(state.ratingOutcome).toBeNull();
  });

  it("sem partida ativa, não guarda nada", () => {
    const state = gameSocketReducer(initialState, {
      type: "GAME_RATED",
      gameId: "G1",
      outcome: OUTCOME,
    });
    expect(state.ratingOutcome).toBeNull();
  });

  it("uma partida nova zera o resultado da anterior", () => {
    let state = gameSocketReducer(inGame(), {
      type: "GAME_RATED",
      gameId: "G1",
      outcome: OUTCOME,
    });
    state = gameSocketReducer(state, {
      type: "GAME_STARTED",
      game: { ...GAME, gameId: "G2" },
    });
    expect(state.ratingOutcome).toBeNull();
  });

  it("sair da partida zera o resultado", () => {
    let state = gameSocketReducer(inGame(), {
      type: "GAME_RATED",
      gameId: "G1",
      outcome: OUTCOME,
    });
    state = gameSocketReducer(state, { type: "CLEAR_GAME", connected: true });
    expect(state.ratingOutcome).toBeNull();
  });
});

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
  // Cor e tempo vêm decididos pelo anfitrião — o convite só informa.
  const INVITATION = {
    fromId: "9",
    fromName: "Renan",
    roomCode: "ABC123",
    timeControl: 600,
    yourColor: "b" as const,
  };

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

// ── Reconnect durante a partida (regressão do lance descartado) ──────────
// O bug: `CONNECTED` devolvia "connected" incondicional, rebaixando uma
// partida ativa. Como `makeMove` só envia em "in_game", todo lance depois de
// uma queda era descartado em silêncio até chegar o `game_rejoined` — que
// podia nunca chegar (o ponteiro de recuperação no servidor vencia antes).

describe("reconnect durante a partida", () => {
  it("queda + reconexão devolve o estado para in_game sem depender do rejoin", () => {
    let state = inGame();
    expect(state.status).toBe("in_game");

    // Socket cai no meio da partida
    state = gameSocketReducer(state, { type: "DISCONNECTED" });
    expect(state.status).toBe("reconnecting");
    expect(state.game).not.toBeNull();

    // Socket volta — ANTES de qualquer game_rejoined do servidor
    state = gameSocketReducer(state, { type: "CONNECTED" });
    expect(state.status).toBe("in_game");
  });

  it("várias reconexões seguidas não rebaixam a partida", () => {
    let state = inGame();
    for (let i = 0; i < 3; i++) {
      state = gameSocketReducer(state, { type: "RECONNECTING" });
      state = gameSocketReducer(state, { type: "CONNECTED" });
    }
    expect(state.status).toBe("in_game");
  });

  it("game_rejoined depois da reconexão continua funcionando (caminho normal)", () => {
    let state = gameSocketReducer(inGame(), { type: "DISCONNECTED" });
    state = gameSocketReducer(state, { type: "CONNECTED" });
    state = gameSocketReducer(state, { type: "GAME_STARTED", game: GAME });
    expect(state.status).toBe("in_game");
  });

  it("partida encerrada NÃO volta para in_game ao reconectar", () => {
    let state = gameSocketReducer(inGame(), {
      type: "GAME_OVER",
      winnerId: "1",
      reason: "checkmate",
    });
    state = gameSocketReducer(state, { type: "CONNECTED" });
    expect(state.status).toBe("connected");
  });

  it("sem partida, reconectar continua devolvendo connected", () => {
    const state = gameSocketReducer(
      { ...initialState, status: "reconnecting" },
      { type: "CONNECTED" }
    );
    expect(state.status).toBe("connected");
  });

  it("erro de lance não derruba a partida do estado in_game", () => {
    let state = inGame();
    state = gameSocketReducer(state, {
      type: "MOVE_ERROR",
      error: "Sem conexão — o lance não foi enviado.",
    });
    expect(state.status).toBe("in_game");
    expect(state.error).toContain("não foi enviado");
  });
});

// Presença de amigos em tempo real (Item 4).
describe("presença de amigos", () => {
  it("WATCH_PRESENCE semeia a lista observada e o online inicial (do fetch REST)", () => {
    const state = gameSocketReducer(initialState, {
      type: "WATCH_PRESENCE",
      ids: ["1", "2", "3"],
      onlineIds: ["2"],
    });
    expect(state.watchedFriendIds).toEqual(["1", "2", "3"]);
    expect(state.onlineFriendIds).toEqual(["2"]);
  });

  it("FRIEND_ONLINE adiciona sem duplicar", () => {
    let state = gameSocketReducer(initialState, {
      type: "WATCH_PRESENCE",
      ids: ["1", "2"],
      onlineIds: ["1"],
    });
    state = gameSocketReducer(state, { type: "FRIEND_ONLINE", id: "2" });
    state = gameSocketReducer(state, { type: "FRIEND_ONLINE", id: "2" });
    expect(state.onlineFriendIds.sort()).toEqual(["1", "2"]);
  });

  it("FRIEND_OFFLINE remove da lista", () => {
    let state = gameSocketReducer(initialState, {
      type: "WATCH_PRESENCE",
      ids: ["1", "2"],
      onlineIds: ["1", "2"],
    });
    state = gameSocketReducer(state, { type: "FRIEND_OFFLINE", id: "1" });
    expect(state.onlineFriendIds).toEqual(["2"]);
  });

  it("PRESENCE_SNAPSHOT substitui a lista pela resposta do servidor", () => {
    let state = gameSocketReducer(initialState, {
      type: "WATCH_PRESENCE",
      ids: ["1", "2", "3"],
      onlineIds: ["1"],
    });
    state = gameSocketReducer(state, {
      type: "PRESENCE_SNAPSHOT",
      onlineIds: ["2", "3"],
    });
    expect(state.onlineFriendIds).toEqual(["2", "3"]);
  });

  it("uma queda de conexão (DISCONNECTED) NÃO zera quem estava online — mantém o último estado conhecido", () => {
    let state = gameSocketReducer(initialState, {
      type: "WATCH_PRESENCE",
      ids: ["1", "2"],
      onlineIds: ["1", "2"],
    });
    state = gameSocketReducer(state, { type: "DISCONNECTED" });
    expect(state.onlineFriendIds).toEqual(["1", "2"]);
    expect(state.watchedFriendIds).toEqual(["1", "2"]);
  });

  it("RECONNECTING também preserva a lista — só uma nova sessão (CONNECTING) reseta", () => {
    let state = gameSocketReducer(initialState, {
      type: "WATCH_PRESENCE",
      ids: ["1"],
      onlineIds: ["1"],
    });
    state = gameSocketReducer(state, { type: "RECONNECTING" });
    expect(state.onlineFriendIds).toEqual(["1"]);

    state = gameSocketReducer(state, { type: "CONNECTING" });
    expect(state.onlineFriendIds).toEqual([]);
    expect(state.watchedFriendIds).toEqual([]);
  });
});
