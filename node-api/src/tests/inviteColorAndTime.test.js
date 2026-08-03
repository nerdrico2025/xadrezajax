// Item 5: o convite de amigo pergunta cor e tempo EXPLICITAMENTE — o
// anfitrião escolhe brancas ou pretas e o convidado recebe a outra. Não há
// mais sorteio de cor em sala nem relógio fixo escondido no servidor.
//
// O cliente SUGERE; o servidor normaliza e decide. Redis em memória, mesmo
// padrão de mock do roomLifecycle.test.js.

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
  renewUserGame: jest.fn(async () => {}),
}));

const {
  createRoom,
  joinRoom,
  resolveHumanTimeControl,
  resolveHostColor,
  HUMAN_TIME_CONTROLS_SECS,
  DEFAULT_TIME_CONTROL_SECS,
} = require("../socket/gameRoom");
const { __store } = require("../services/redis.service");

const HOST = { id: "1", socket: "s1" };
const GUEST = { id: "2", socket: "s2" };

afterEach(() => {
  __store.clear();
  jest.clearAllMocks();
});

describe("resolveHumanTimeControl — o cliente sugere, o servidor decide", () => {
  test.each(HUMAN_TIME_CONTROLS_SECS)("aceita %i s (valor da lista)", (secs) => {
    expect(resolveHumanTimeControl(secs)).toBe(secs);
  });

  test.each([
    ["valor fora da lista", 7],
    ["tempo negativo", -300],
    ["zero", 0],
    ["texto", "muito rápido"],
    ["null", null],
    ["ausente", undefined],
  ])("%s cai no default", (_label, value) => {
    expect(resolveHumanTimeControl(value)).toBe(DEFAULT_TIME_CONTROL_SECS);
  });

  test("não existe partida humana sem relógio", () => {
    // `null` seria "sem relógio" no wizard vs IA; para humano vira default.
    expect(resolveHumanTimeControl(null)).toBe(DEFAULT_TIME_CONTROL_SECS);
    expect(HUMAN_TIME_CONTROLS_SECS).not.toContain(null);
  });
});

describe("resolveHostColor", () => {
  test("aceita só w e b", () => {
    expect(resolveHostColor("w")).toBe("w");
    expect(resolveHostColor("b")).toBe("b");
  });

  test.each([["random"], ["W"], [""], [null], [undefined], [1]])(
    "%p vira null (sorteio)",
    (value) => {
      expect(resolveHostColor(value)).toBeNull();
    }
  );
});

describe("convite: cor escolhida pelo anfitrião", () => {
  test("anfitrião escolhe brancas — convidado recebe pretas", async () => {
    const code = await createRoom(HOST.id, HOST.socket, {}, { hostColor: "w" });

    const { white, black } = await joinRoom(code, GUEST.id, GUEST.socket, {});

    expect(white.userId).toBe(HOST.id);
    expect(black.userId).toBe(GUEST.id);
  });

  test("anfitrião escolhe pretas — convidado recebe brancas", async () => {
    const code = await createRoom(HOST.id, HOST.socket, {}, { hostColor: "b" });

    const { white, black } = await joinRoom(code, GUEST.id, GUEST.socket, {});

    expect(white.userId).toBe(GUEST.id);
    expect(black.userId).toBe(HOST.id);
  });

  test("a escolha é determinística — 20 entradas, mesma cor", async () => {
    // Sem isto o teste passaria por sorte metade das vezes com o sorteio antigo.
    for (let i = 0; i < 20; i++) {
      const code = await createRoom(HOST.id, HOST.socket, {}, { hostColor: "b" });
      const { white } = await joinRoom(code, GUEST.id, GUEST.socket, {});
      expect(white.userId).toBe(GUEST.id);
    }
  });

  test("sala sem cor gravada mantém o sorteio (compatibilidade)", async () => {
    // Sala criada antes desta versão: host_color vazio → sorteia, sem quebrar.
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const code = await createRoom(HOST.id, HOST.socket, {});
      const { white } = await joinRoom(code, GUEST.id, GUEST.socket, {});
      seen.add(white.userId);
    }
    expect(seen.size).toBe(2);
  });

  test("cor inválida vinda do cliente não vira cor — cai no sorteio", async () => {
    const code = await createRoom(
      HOST.id,
      HOST.socket,
      {},
      { hostColor: "roxo" }
    );
    expect(__store.get(`room:${code}`).host_color).toBe("");
  });
});

describe("convite: tempo escolhido pelo anfitrião", () => {
  test("a partida nasce com o tempo escolhido", async () => {
    const code = await createRoom(HOST.id, HOST.socket, {}, { timeControl: 180 });

    const { timeControl, gameId } = await joinRoom(
      code,
      GUEST.id,
      GUEST.socket,
      {}
    );

    expect(timeControl).toBe(180);
    const game = __store.get(`game:${gameId}`);
    expect(game.time_control).toBe("180");
    // Os dois relógios começam iguais e cheios.
    expect(game.white_time_ms).toBe("180000");
    expect(game.black_time_ms).toBe("180000");
  });

  test("tempo fora da lista é normalizado ANTES de gravar na sala", async () => {
    const code = await createRoom(HOST.id, HOST.socket, {}, { timeControl: 7 });

    expect(__store.get(`room:${code}`).time_control).toBe(
      String(DEFAULT_TIME_CONTROL_SECS)
    );
  });

  test("sala sem tempo gravado cai no default (compatibilidade)", async () => {
    const code = await createRoom(HOST.id, HOST.socket, {});
    const { timeControl } = await joinRoom(code, GUEST.id, GUEST.socket, {});

    expect(timeControl).toBe(DEFAULT_TIME_CONTROL_SECS);
  });
});
