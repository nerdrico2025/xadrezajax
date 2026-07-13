// Testes das ações de fim de partida (desistência e empate por acordo)
// com Redis em memória — mesmo padrão de mock do game.controller.test.js.

jest.mock("../services/redis.service", () => {
  const store = new Map();
  const redis = {
    hset: async (key, fields) => {
      store.set(key, { ...(store.get(key) || {}), ...fields });
    },
    hgetall: async (key) => ({ ...(store.get(key) || {}) }),
    expire: async () => {},
    del: async (key) => {
      store.delete(key);
    },
  };
  return { getRedis: () => redis, __store: store };
});

jest.mock("../socket/matchmaking", () => ({
  setUserGame: jest.fn(async () => {}),
}));

const {
  createGame,
  getGame,
  resignGame,
  offerDraw,
  acceptDraw,
  declineDraw,
} = require("../socket/gameRoom");
const { setUserGame } = require("../socket/matchmaking");

const WHITE = { userId: "1", socketId: "sw" };
const BLACK = { userId: "2", socketId: "sb" };

async function newGame() {
  return createGame(WHITE, BLACK);
}

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

// ── resignGame ───────────────────────────────────────────────────────

describe("resignGame", () => {
  test("brancas desistem → pretas vencem e partida encerra", async () => {
    const gameId = await newGame();
    const result = await resignGame(gameId, "1");

    expect(result).toMatchObject({ winner: "black", reason: "resign" });
    expect((await getGame(gameId)).status).toBe("finished");
    expect(setUserGame).toHaveBeenCalledWith("1", null);
    expect(setUserGame).toHaveBeenCalledWith("2", null);
  });

  test("pretas desistem → brancas vencem", async () => {
    const gameId = await newGame();
    const result = await resignGame(gameId, "2");
    expect(result).toMatchObject({ winner: "white", reason: "resign" });
  });

  test("erro para partida inexistente ou já encerrada", async () => {
    expect(await resignGame("NAOEXISTE", "1")).toHaveProperty("error");

    const gameId = await newGame();
    await resignGame(gameId, "1");
    expect(await resignGame(gameId, "2")).toHaveProperty("error");
  });
});

// ── offerDraw ────────────────────────────────────────────────────────

describe("offerDraw", () => {
  test("registra a proposta com autor e timestamp", async () => {
    const gameId = await newGame();
    const result = await offerDraw(gameId, "1");

    expect(result).toMatchObject({
      offered_by: "1",
      white_id: "1",
      black_id: "2",
    });
    const game = await getGame(gameId);
    expect(game.draw_offer_by).toBe("1");
    expect(Number(game.draw_offer_at)).toBeGreaterThan(0);
  });

  test("erro se quem propõe não está na partida", async () => {
    const gameId = await newGame();
    expect(await offerDraw(gameId, "99")).toHaveProperty("error");
  });

  test("erro para partida inexistente ou encerrada", async () => {
    expect(await offerDraw("NAOEXISTE", "1")).toHaveProperty("error");

    const gameId = await newGame();
    await resignGame(gameId, "1");
    expect(await offerDraw(gameId, "1")).toHaveProperty("error");
  });
});

// ── acceptDraw ───────────────────────────────────────────────────────

describe("acceptDraw", () => {
  test("oponente aceita → empate por acordo e partida encerra", async () => {
    const gameId = await newGame();
    await offerDraw(gameId, "1");
    const result = await acceptDraw(gameId, "2");

    expect(result).toMatchObject({
      winner: null,
      reason: "agreement",
      white_id: "1",
      black_id: "2",
    });
    const game = await getGame(gameId);
    expect(game.status).toBe("finished");
    expect(game.draw_offer_by).toBe("");
    expect(setUserGame).toHaveBeenCalledWith("1", null);
    expect(setUserGame).toHaveBeenCalledWith("2", null);
  });

  test("erro se não há proposta pendente", async () => {
    const gameId = await newGame();
    expect(await acceptDraw(gameId, "2")).toHaveProperty("error");
  });

  test("erro se o próprio autor tenta aceitar a proposta", async () => {
    const gameId = await newGame();
    await offerDraw(gameId, "1");
    expect(await acceptDraw(gameId, "1")).toHaveProperty("error");

    // A proposta continua válida para o oponente
    expect(await acceptDraw(gameId, "2")).toMatchObject({ winner: null });
  });

  test("erro se a proposta expirou (TTL) e a proposta é limpa", async () => {
    const gameId = await newGame();
    await offerDraw(gameId, "1");

    const realNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(realNow + 61_000);

    expect(await acceptDraw(gameId, "2")).toHaveProperty("error");
    expect((await getGame(gameId)).draw_offer_by).toBe("");
    expect((await getGame(gameId)).status).toBe("active");
  });

  test("erro para partida já encerrada", async () => {
    const gameId = await newGame();
    await offerDraw(gameId, "1");
    await resignGame(gameId, "1");
    expect(await acceptDraw(gameId, "2")).toHaveProperty("error");
  });
});

// ── declineDraw ──────────────────────────────────────────────────────

describe("declineDraw", () => {
  test("recusa limpa a proposta e mantém a partida ativa", async () => {
    const gameId = await newGame();
    await offerDraw(gameId, "1");
    const result = await declineDraw(gameId, "2");

    expect(result).toMatchObject({ declined_by: "2", offered_by: "1" });
    const game = await getGame(gameId);
    expect(game.status).toBe("active");
    expect(game.draw_offer_by).toBe("");

    // Depois de recusada, não dá mais para aceitar
    expect(await acceptDraw(gameId, "2")).toHaveProperty("error");
  });

  test("erro se não há proposta ou se o autor tenta recusar a própria", async () => {
    const gameId = await newGame();
    expect(await declineDraw(gameId, "2")).toHaveProperty("error");

    await offerDraw(gameId, "1");
    expect(await declineDraw(gameId, "1")).toHaveProperty("error");
  });
});
