// Ciclo de vida do convite por sala: PROPOR → ACEITAR | RECUSAR | SAIR.
// Redis em memória — mesmo padrão de mock do gameRoom.test.js.

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
  createRoom,
  joinRoom,
  closeRoom,
  ROOM_KIND_FRIEND,
  ROOM_CLOSE_CANCELLED,
  ROOM_CLOSE_DECLINED,
  ROOM_CLOSE_EXPIRED,
} = require("../socket/gameRoom");
const { __store } = require("../services/redis.service");

const CREATOR = { id: "1", socket: "s1" };
const INVITEE = { id: "2", socket: "s2" };

afterEach(() => {
  __store.clear();
  jest.clearAllMocks();
});

// ── SAIR (criador cancela) ───────────────────────────────────────────────

describe("closeRoom — criador cancela o convite", () => {
  test("invalida a sala e aponta o convidado como quem deve ser avisado", async () => {
    const code = await createRoom(CREATOR.id, CREATOR.socket, {}, {
      inviteeId: INVITEE.id,
    });

    const result = await closeRoom(code, CREATOR.id);

    expect(result.error).toBeUndefined();
    expect(result.reason).toBe(ROOM_CLOSE_CANCELLED);
    expect(result.notifyUserId).toBe(INVITEE.id);
    expect(result.kind).toBe(ROOM_KIND_FRIEND);
    expect(__store.has(`room:${code}`)).toBe(false);
  });

  test("sala cancelada não aceita mais entrada — o convidado não cai numa partida abandonada", async () => {
    const code = await createRoom(CREATOR.id, CREATOR.socket, {}, {
      inviteeId: INVITEE.id,
    });
    await closeRoom(code, CREATOR.id);

    const joined = await joinRoom(code, INVITEE.id, INVITEE.socket, {});
    expect(joined.error).toBe("Sala não encontrada");
    expect(joined.gameId).toBeUndefined();
  });

  test("sala só-por-código (sem convidado) não tem ninguém a notificar", async () => {
    const code = await createRoom(CREATOR.id, CREATOR.socket, {});

    const result = await closeRoom(code, CREATOR.id);

    expect(result.reason).toBe(ROOM_CLOSE_CANCELLED);
    expect(result.notifyUserId).toBeNull();
    expect(__store.has(`room:${code}`)).toBe(false);
  });
});

// ── RECUSAR (convidado recusa) ───────────────────────────────────────────

describe("closeRoom — convidado recusa o convite", () => {
  test("mesmo teardown, motivo 'declined' e notifica o criador", async () => {
    const code = await createRoom(CREATOR.id, CREATOR.socket, {}, {
      inviteeId: INVITEE.id,
    });

    const result = await closeRoom(code, INVITEE.id);

    expect(result.reason).toBe(ROOM_CLOSE_DECLINED);
    expect(result.notifyUserId).toBe(CREATOR.id);
    expect(__store.has(`room:${code}`)).toBe(false);
  });
});

// ── Bordas ───────────────────────────────────────────────────────────────

describe("closeRoom — bordas", () => {
  test("quem não participa da sala não consegue fechá-la", async () => {
    const code = await createRoom(CREATOR.id, CREATOR.socket, {}, {
      inviteeId: INVITEE.id,
    });

    const result = await closeRoom(code, "99");

    expect(result.error).toBe("Você não participa desta sala");
    expect(__store.has(`room:${code}`)).toBe(true);
  });

  test("sala inexistente devolve 'expired' em vez de erro (idempotente)", async () => {
    const result = await closeRoom("ZZZZZZ", CREATOR.id);

    expect(result.error).toBeUndefined();
    expect(result.reason).toBe(ROOM_CLOSE_EXPIRED);
    expect(result.notifyUserId).toBeNull();
  });

  test("fechar duas vezes é seguro — a segunda vira 'expired'", async () => {
    const code = await createRoom(CREATOR.id, CREATOR.socket, {}, {
      inviteeId: INVITEE.id,
    });

    await closeRoom(code, CREATOR.id);
    const second = await closeRoom(code, CREATOR.id);

    expect(second.reason).toBe(ROOM_CLOSE_EXPIRED);
  });
});

// ── ACEITAR (regressão: o caminho feliz continua intacto) ────────────────

describe("joinRoom — caminho feliz preservado", () => {
  test("entrar numa sala viva cria a partida e propaga a identidade dos dois", async () => {
    const code = await createRoom(
      CREATOR.id,
      CREATOR.socket,
      { username: "rafael", rating: 1500 },
      { inviteeId: INVITEE.id }
    );

    const result = await joinRoom(code, INVITEE.id, INVITEE.socket, {
      username: "renan",
      rating: 1480,
    });

    expect(result.error).toBeUndefined();
    expect(result.gameId).toBeTruthy();

    const metas = [result.white.meta, result.black.meta];
    expect(metas.map((m) => m.username).sort()).toEqual(["rafael", "renan"]);
  });
});
