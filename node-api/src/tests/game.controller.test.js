const request = require("supertest");
const app = require("../../src/app");

// Mocka o serviço do Stockfish para não precisar do binário nos testes
jest.mock("../services/stockfish.service", () => ({
  getBestMove: jest.fn(),
  DEPTH_BY_DIFFICULTY: { easy: 2, medium: 8, hard: 18 },
}));

const { getBestMove } = require("../services/stockfish.service");

const VALID_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("POST /api/v1/game/move", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Caminho feliz ──────────────────────────────────────────────────

  test("retorna 200 e bestMove quando Stockfish responde", async () => {
    getBestMove.mockResolvedValue("e7e5");

    const res = await request(app)
      .post("/api/v1/game/move")
      .send({ fen: VALID_FEN });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("bestMove", "e7e5");
  });

  test("repassa o FEN correto para o Stockfish", async () => {
    getBestMove.mockResolvedValue("d7d5");

    await request(app)
      .post("/api/v1/game/move")
      .send({ fen: VALID_FEN });

    expect(getBestMove).toHaveBeenCalledWith(VALID_FEN, 8);
    expect(getBestMove).toHaveBeenCalledTimes(1);
  });

  // ── Validação de entrada ───────────────────────────────────────────

  test("retorna 400 quando o campo fen está ausente", async () => {
    const res = await request(app)
      .post("/api/v1/game/move")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("retorna 400 quando fen não é string", async () => {
    const res = await request(app)
      .post("/api/v1/game/move")
      .send({ fen: 12345 });

    expect(res.status).toBe(400);
    expect(getBestMove).not.toHaveBeenCalled();
  });

  test("retorna 400 quando body está vazio", async () => {
    const res = await request(app)
      .post("/api/v1/game/move")
      .send();

    expect(res.status).toBe(400);
  });

  // ── Falha do Stockfish ─────────────────────────────────────────────

  test("retorna 422 quando Stockfish não retorna jogada", async () => {
    getBestMove.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/v1/game/move")
      .send({ fen: VALID_FEN });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });

  test("retorna 500 quando Stockfish lança exceção", async () => {
    getBestMove.mockRejectedValue(new Error("Stockfish timeout"));

    const res = await request(app)
      .post("/api/v1/game/move")
      .send({ fen: VALID_FEN });

    expect(res.status).toBe(500);
  });

  // ── Health check ───────────────────────────────────────────────────

  test("GET /health retorna status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
  });
});
