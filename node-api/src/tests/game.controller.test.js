const request = require("supertest");
const jwt = require("jsonwebtoken");

// SECRET_KEY precisa existir ANTES do require do app (o middleware de auth lê
// do ambiente a cada request, mas deixar explícito aqui evita ordem frágil).
process.env.SECRET_KEY = process.env.SECRET_KEY || "test-secret-key";

const app = require("../../src/app");

// Mocka o serviço do Stockfish para não precisar do binário nos testes
jest.mock("../services/stockfish.service", () => ({
  getBestMove: jest.fn(),
  LEVELS: {
    beginner: {}, easy: {}, medium: {}, hard: {}, master: {},
  },
  DEFAULT_LEVEL: "medium",
  poolStats: jest.fn(() => ({
    size: 2, total: 1, idle: 1, waiting: 0,
    queued: 0, waitingPeak: 0, queueFull: 0, queueTimeouts: 0, discarded: 0,
  })),
  // O pool de análise consome este parser (é puro; vale o real).
  parseMultipvLine: jest.requireActual("../services/stockfish.service.js")
    .parseMultipvLine,
}));

const { getBestMove } = require("../services/stockfish.service");

const VALID_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

/** Access token no mesmo formato do SimpleJWT (Django). */
function accessToken(overrides = {}) {
  return jwt.sign(
    { token_type: "access", user_id: 42, ...overrides },
    process.env.SECRET_KEY,
    { algorithm: "HS256" }
  );
}

/** POST autenticado — o endpoint da engine não atende mais anônimo. */
function postMove(body) {
  return request(app)
    .post("/api/v1/game/move")
    .set("Authorization", `Bearer ${accessToken()}`)
    .send(body);
}

describe("POST /api/v1/game/move", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Caminho feliz ──────────────────────────────────────────────────

  test("retorna 200 e bestMove quando Stockfish responde", async () => {
    getBestMove.mockResolvedValue("e7e5");

    const res = await postMove({ fen: VALID_FEN });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("bestMove", "e7e5");
  });

  test("sem difficulty/depth, usa o nível padrão", async () => {
    getBestMove.mockResolvedValue("d7d5");

    await postMove({ fen: VALID_FEN });

    expect(getBestMove).toHaveBeenCalledWith(VALID_FEN, "medium");
    expect(getBestMove).toHaveBeenCalledTimes(1);
  });

  test("repassa o nível de dificuldade recebido", async () => {
    getBestMove.mockResolvedValue("d7d5");

    await postMove({ fen: VALID_FEN, difficulty: "beginner" });

    expect(getBestMove).toHaveBeenCalledWith(VALID_FEN, "beginner");
  });

  test("compatibilidade: aceita depth numérico legado", async () => {
    getBestMove.mockResolvedValue("d7d5");

    await postMove({ fen: VALID_FEN, depth: 12 });

    expect(getBestMove).toHaveBeenCalledWith(VALID_FEN, 12);
  });

  // ── Validação de entrada ───────────────────────────────────────────

  test("retorna 400 quando o campo fen está ausente", async () => {
    const res = await postMove({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("retorna 400 quando fen não é string", async () => {
    const res = await postMove({ fen: 12345 });

    expect(res.status).toBe(400);
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("retorna 400 quando body está vazio", async () => {
    const res = await postMove();

    expect(res.status).toBe(400);
  });

  // ── Falha do Stockfish ─────────────────────────────────────────────

  test("retorna 422 quando Stockfish não retorna jogada", async () => {
    getBestMove.mockResolvedValue(null);

    const res = await postMove({ fen: VALID_FEN });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });

  test("retorna 500 quando Stockfish lança exceção", async () => {
    getBestMove.mockRejectedValue(new Error("Stockfish timeout"));

    const res = await postMove({ fen: VALID_FEN });

    expect(res.status).toBe(500);
  });

  // ── Health check ───────────────────────────────────────────────────

  test("GET /health retorna status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
  });

  test("GET /health expõe o estado do pool de engines", async () => {
    // É o que permite ver contenção de fora, sem shell no container: sem
    // `waiting`/`queued` visíveis, "o lance demorou" fica sendo hipótese.
    const res = await request(app).get("/health");

    expect(res.body.engine).toMatchObject({
      size: expect.any(Number),
      total: expect.any(Number),
      idle: expect.any(Number),
      waiting: expect.any(Number),
      queued: expect.any(Number),
      waitingPeak: expect.any(Number),
      queueFull: expect.any(Number),
      queueTimeouts: expect.any(Number),
      discarded: expect.any(Number),
    });
  });

  test("/health continua ABERTO (sem token) — é sonda de infra", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  test("GET /health expõe o pool de ANÁLISE separado do pool ao vivo", async () => {
    // Ler os dois lado a lado é o que permite responder se a análise está
    // tirando engine das partidas ao vivo.
    const res = await request(app).get("/health");

    expect(res.body.analysis).toMatchObject({
      size: expect.any(Number),
      waiting: expect.any(Number),
      queued: expect.any(Number),
    });
    // Um engine para análise, contra o pool ao vivo (que vem do mock com 2).
    expect(res.body.analysis.size).toBe(1);
    expect(res.body.analysis.size).not.toBe(res.body.engine.size);
  });
});

// ── Autenticação ─────────────────────────────────────────────────────
//
// A engine é o recurso mais caro do serviço (um processo Stockfish por busca,
// com fila e teto) e ficou aberta desde sempre: qualquer um com a URL a
// consumia. Mesmo token e mesmas regras do WebSocket (services/jwt.js).

describe("POST /api/v1/game/move — autenticação", () => {
  afterEach(() => jest.clearAllMocks());

  function post(headers = {}) {
    const req = request(app).post("/api/v1/game/move");
    for (const [name, value] of Object.entries(headers)) req.set(name, value);
    return req.send({ fen: VALID_FEN });
  }

  test("SEM token: 401 e a engine nem é consultada", async () => {
    const res = await post();

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    // O ponto inteiro da mudança: requisição anônima não gasta engine.
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("header Authorization malformado (sem 'Bearer') é 401", async () => {
    const res = await post({ Authorization: accessToken() });

    expect(res.status).toBe(401);
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("token assinado com OUTRO segredo é 401", async () => {
    const forged = jwt.sign(
      { token_type: "access", user_id: 42 },
      "segredo-errado",
      { algorithm: "HS256" }
    );
    const res = await post({ Authorization: `Bearer ${forged}` });

    expect(res.status).toBe(401);
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("token EXPIRADO é 401", async () => {
    const expired = jwt.sign(
      { token_type: "access", user_id: 42, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.SECRET_KEY,
      { algorithm: "HS256" }
    );
    const res = await post({ Authorization: `Bearer ${expired}` });

    expect(res.status).toBe(401);
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("REFRESH token não abre a porta do access", async () => {
    const refresh = jwt.sign(
      { token_type: "refresh", user_id: 42 },
      process.env.SECRET_KEY,
      { algorithm: "HS256" }
    );
    const res = await post({ Authorization: `Bearer ${refresh}` });

    expect(res.status).toBe(401);
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("401 carrega code 'token_not_valid' (o app renova a sessão com isso)", async () => {
    // Sem este código o `authFetch` do app não reconhece o 401 como
    // renovável, e uma partida vs IA que passe dos 30 min do access token
    // quebraria no meio em vez de renovar sozinha.
    const res = await post();
    expect(res.body.code).toBe("token_not_valid");
  });

  test("token válido passa e a engine é consultada", async () => {
    getBestMove.mockResolvedValue("e7e5");

    const res = await post({ Authorization: `Bearer ${accessToken()}` });

    expect(res.status).toBe(200);
    expect(getBestMove).toHaveBeenCalledTimes(1);
  });

  test("sem SECRET_KEY o serviço FALHA FECHADO (500), nunca libera", async () => {
    const original = process.env.SECRET_KEY;
    process.env.SECRET_KEY = "";
    try {
      const res = await post({ Authorization: "Bearer qualquer-coisa" });
      expect(res.status).toBe(500);
      expect(getBestMove).not.toHaveBeenCalled();
      // Erro interno não descreve o interno.
      expect(res.body.code).toBeUndefined();
    } finally {
      process.env.SECRET_KEY = original;
    }
  });
});
