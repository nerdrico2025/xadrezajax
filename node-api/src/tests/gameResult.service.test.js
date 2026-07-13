// O serviço repassa time_control ao backend Django, que o converte em
// modalidade Glicko-2 (bullet/blitz/rapid). fetch é mockado — sem rede.

describe("reportGameResult", () => {
  const originalEnv = process.env.INTERNAL_API_SECRET;
  let reportGameResult;

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_SECRET = "test-secret";
    ({ reportGameResult } = require("../services/gameResult.service"));

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        modality: "blitz",
        white: { rating: 1510 },
        black: { rating: 1490 },
      }),
    }));
  });

  afterEach(() => {
    process.env.INTERNAL_API_SECRET = originalEnv;
    jest.restoreAllMocks();
  });

  test("envia time_control em segundos no payload", async () => {
    await reportGameResult("1", "2", "white", 300);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      white_id: "1",
      black_id: "2",
      result: "white",
      time_control: 300,
    });
    expect(options.headers["X-Internal-Secret"]).toBe("test-secret");
  });

  test("partida sem relógio envia time_control null (→ rápido no backend)", async () => {
    await reportGameResult("1", "2", "draw");

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body).time_control).toBeNull();
  });

  test("sem INTERNAL_API_SECRET não chama o backend", async () => {
    jest.resetModules();
    process.env.INTERNAL_API_SECRET = "";
    const svc = require("../services/gameResult.service");

    await svc.reportGameResult("1", "2", "white", 300);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("canPlayGame (gating pré-fila de matchmaking)", () => {
  const originalEnv = process.env.INTERNAL_API_SECRET;
  let canPlayGame;

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_SECRET = "test-secret";
    ({ canPlayGame } = require("../services/gameResult.service"));
  });

  afterEach(() => {
    process.env.INTERNAL_API_SECRET = originalEnv;
    jest.restoreAllMocks();
  });

  test("consulta o endpoint interno com o segredo e repassa a resposta", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        can_play: false,
        remaining_games_today: 0,
        code: "daily_limit_reached",
      }),
    }));

    const result = await canPlayGame("42");

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/payments/internal/can-play/?user_id=42");
    expect(options.headers["X-Internal-Secret"]).toBe("test-secret");
    expect(result.can_play).toBe(false);
    expect(result.code).toBe("daily_limit_reached");
  });

  test("fail-open: backend fora do ar não trava o matchmaking", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect((await canPlayGame("42")).can_play).toBe(true);
  });

  test("fail-open: resposta não-2xx libera por segurança", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    expect((await canPlayGame("42")).can_play).toBe(true);
  });

  test("sem INTERNAL_API_SECRET libera sem chamar o backend", async () => {
    jest.resetModules();
    process.env.INTERNAL_API_SECRET = "";
    const svc = require("../services/gameResult.service");
    global.fetch = jest.fn();

    expect((await svc.canPlayGame("42")).can_play).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
