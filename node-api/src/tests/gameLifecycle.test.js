// Integridade do ciclo de vida da partida: relógio obrigatório, janela de
// recuperação (TTL) e política de carência por abandono.
// Redis em memória — mesmo padrão de mock do gameRoom.test.js.

jest.mock("../services/redis.service", () => {
  const store = new Map();
  const ttls = new Map();
  const redis = {
    hset: async (key, fields) => {
      store.set(key, { ...(store.get(key) || {}), ...fields });
    },
    hgetall: async (key) => ({ ...(store.get(key) || {}) }),
    expire: async (key, ttl) => {
      ttls.set(key, ttl);
    },
    del: async (key) => {
      store.delete(key);
      ttls.delete(key);
    },
    set: async (key, value, _mode, ttl) => {
      store.set(key, value);
      ttls.set(key, ttl);
    },
    get: async (key) => store.get(key) ?? null,
    // Lances da partida (`game:{id}:moves`) — lista, não hash.
    rpush: async (key, value) => {
      const list = store.get(key) || [];
      list.push(value);
      store.set(key, list);
      return list.length;
    },
    lrange: async (key) => [...(store.get(key) || [])],
  };
  return { getRedis: () => redis, __store: store, __ttls: ttls };
});

const { Chess } = require("chess.js");
const {
  createGame,
  getGame,
  applyMove,
  joinRoom,
  createRoom,
  abandonGraceMs,
  DEFAULT_TIME_CONTROL_SECS,
  ABANDON_GRACE_MS,
} = require("../socket/gameRoom");
const { setUserGame, getUserGame } = require("../socket/matchmaking");
const { GAME_TTL } = require("../socket/ttl");
const { __store, __ttls } = require("../services/redis.service");

const WHITE = { userId: "1", socketId: "sw" };
const BLACK = { userId: "2", socketId: "sb" };

afterEach(() => {
  __store.clear();
  __ttls.clear();
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ── Relógio obrigatório em partida humana ────────────────────────────────

describe("relógio obrigatório", () => {
  test("sala humana nasce COM relógio, decidido pelo servidor", async () => {
    const code = await createRoom("1", "sw", {});
    const { gameId } = await joinRoom(code, "2", "sb", {});

    const game = await getGame(gameId);
    expect(game.time_control).toBe(String(DEFAULT_TIME_CONTROL_SECS));
    expect(parseInt(game.white_time_ms)).toBe(DEFAULT_TIME_CONTROL_SECS * 1000);
    expect(parseInt(game.black_time_ms)).toBe(DEFAULT_TIME_CONTROL_SECS * 1000);
  });

  test("o padrão do servidor é 10 minutos", () => {
    expect(DEFAULT_TIME_CONTROL_SECS).toBe(600);
  });
});

// ── Janela de recuperação (o bug do lance descartado) ────────────────────

describe("TTL da chave de recuperação", () => {
  test("nasce com a MESMA janela da partida — nunca menor", async () => {
    const gameId = await createGame(WHITE, BLACK, 300);

    expect(__ttls.get(`game:${gameId}`)).toBe(GAME_TTL);
    expect(__ttls.get(`user:game:${WHITE.userId}`)).toBe(GAME_TTL);
    expect(__ttls.get(`user:game:${BLACK.userId}`)).toBe(GAME_TTL);
  });

  test("é renovada a cada lance, junto com a partida", async () => {
    const gameId = await createGame(WHITE, BLACK, 300);

    // Simula a janela tendo encolhido (o que acontecia na prática: só a
    // partida era renovada e o ponteiro ia morrendo sozinho).
    __ttls.set(`user:game:${WHITE.userId}`, 5);
    __ttls.set(`user:game:${BLACK.userId}`, 5);

    const result = await applyMove(gameId, WHITE.userId, "e2", "e4");
    expect(result.error).toBeUndefined();

    expect(__ttls.get(`game:${gameId}`)).toBe(GAME_TTL);
    expect(__ttls.get(`user:game:${WHITE.userId}`)).toBe(GAME_TTL);
    expect(__ttls.get(`user:game:${BLACK.userId}`)).toBe(GAME_TTL);
  });

  test("o ponteiro de recuperação sobrevive para o rejoin encontrar a partida", async () => {
    const gameId = await createGame(WHITE, BLACK, 300);
    await applyMove(gameId, WHITE.userId, "e2", "e4");

    // É exatamente o que o handler de connection consulta ao reconectar.
    expect(await getUserGame(WHITE.userId)).toBe(gameId);
    expect(await getUserGame(BLACK.userId)).toBe(gameId);
  });

  test("os lances vencem junto com a partida, nunca antes", async () => {
    // Mesma classe de bug do ponteiro de recuperação: uma chave da partida
    // com janela menor que a outra. Se os lances expirassem primeiro, uma
    // partida longa chegaria ao Django sem nada para gravar.
    const gameId = await createGame(WHITE, BLACK, 300);
    __ttls.set(`game:${gameId}:moves`, 5);

    await applyMove(gameId, WHITE.userId, "e2", "e4");

    expect(__ttls.get(`game:${gameId}:moves`)).toBe(GAME_TTL);
    expect(__ttls.get(`game:${gameId}`)).toBe(GAME_TTL);
  });

  test("fim de partida limpa o ponteiro dos dois jogadores", async () => {
    const gameId = await createGame(WHITE, BLACK, 300);
    await setUserGame(WHITE.userId, null);

    expect(await getUserGame(WHITE.userId)).toBeNull();
    expect(await getUserGame(BLACK.userId)).toBe(gameId);
  });
});

// ── Carência por abandono ────────────────────────────────────────────────

describe("abandonGraceMs", () => {
  function gameWith(overrides = {}) {
    return {
      white_id: "1",
      black_id: "2",
      fen: new Chess().fen(), // vez das brancas
      time_control: "300",
      white_time_ms: "300000",
      black_time_ms: "300000",
      last_move_at: "",
      ...overrides,
    };
  }

  test("relógio folgado → carência cheia de 60s", () => {
    expect(abandonGraceMs(gameWith(), "1")).toBe(ABANDON_GRACE_MS);
    expect(ABANDON_GRACE_MS).toBe(60_000);
  });

  test("relógio menor que a carência → vale o relógio", () => {
    // 12s restantes: quem cai não pode ganhar 60s de sobrevida.
    const grace = abandonGraceMs(gameWith({ white_time_ms: "12000" }), "1");
    expect(grace).toBe(12_000);
  });

  test("desconta o tempo já corrido quando é a vez de quem caiu", () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    const game = gameWith({
      white_time_ms: "30000",
      last_move_at: String(now - 25_000), // 25s já escorreram
    });

    // 30s - 25s = 5s de relógio real
    expect(abandonGraceMs(game, "1")).toBe(5_000);
  });

  test("não desconta nada de quem caiu fora da própria vez", () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    const game = gameWith({
      black_time_ms: "30000",
      last_move_at: String(now - 25_000),
    });

    // É a vez das brancas; o relógio das pretas está parado.
    expect(abandonGraceMs(game, "2")).toBe(30_000);
  });

  test("relógio zerado → encerra imediatamente, sem carência", () => {
    expect(abandonGraceMs(gameWith({ white_time_ms: "0" }), "1")).toBe(0);
  });

  test("nunca devolve valor negativo", () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    const game = gameWith({
      white_time_ms: "1000",
      last_move_at: String(now - 90_000), // estourou faz tempo
    });

    expect(abandonGraceMs(game, "1")).toBe(0);
  });

  test("partida legada sem relógio cai na carência fixa", () => {
    const game = gameWith({ time_control: "", white_time_ms: "" });
    expect(abandonGraceMs(game, "1")).toBe(ABANDON_GRACE_MS);
  });
});
