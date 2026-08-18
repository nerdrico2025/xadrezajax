// Presença de amigos em tempo real (Item 4) — Redis em memória, mesmo
// padrão de mock do gameRoom.test.js.

jest.mock("../services/redis.service", () => {
  const store = new Set();
  const redis = {
    exists: async (key) => (store.has(key) ? 1 : 0),
    pipeline: () => {
      const ops = [];
      const pipeline = {
        exists: (key) => {
          ops.push(key);
          return pipeline;
        },
        exec: async () => ops.map((key) => [null, store.has(key) ? 1 : 0]),
      };
      return pipeline;
    },
  };
  return { getRedis: () => redis, __store: store };
});

const {
  MAX_WATCHED_IDS,
  presenceRoom,
  normalizeWatchIds,
  getOnlineSnapshot,
} = require("../socket/presence");
const { __store } = require("../services/redis.service");

afterEach(() => {
  __store.clear();
});

describe("presenceRoom", () => {
  test("gera um nome de sala estável por usuário", () => {
    expect(presenceRoom(42)).toBe("presence:42");
    expect(presenceRoom("42")).toBe("presence:42");
  });
});

describe("normalizeWatchIds", () => {
  test("converte tudo para string", () => {
    expect(normalizeWatchIds([1, 2, "3"])).toEqual(["1", "2", "3"]);
  });

  test("entrada que não é array vira lista vazia (evita crash em payload malformado)", () => {
    expect(normalizeWatchIds(undefined)).toEqual([]);
    expect(normalizeWatchIds("42")).toEqual([]);
    expect(normalizeWatchIds(null)).toEqual([]);
  });

  test("limita ao teto — cliente não pode pedir para observar o mundo inteiro", () => {
    const muitos = Array.from({ length: MAX_WATCHED_IDS + 50 }, (_, i) => i);
    expect(normalizeWatchIds(muitos)).toHaveLength(MAX_WATCHED_IDS);
  });
});

describe("getOnlineSnapshot", () => {
  test("lista vazia não bate no Redis e devolve vazio", async () => {
    expect(await getOnlineSnapshot([])).toEqual([]);
  });

  test("devolve só os IDs que estão de fato online:{id} no Redis", async () => {
    __store.add("online:1");
    __store.add("online:3");

    const online = await getOnlineSnapshot(["1", "2", "3"]);

    expect(online.sort()).toEqual(["1", "3"]);
  });

  test("nenhum dos observados está online → vazio, não undefined/erro", async () => {
    expect(await getOnlineSnapshot(["1", "2"])).toEqual([]);
  });
});
