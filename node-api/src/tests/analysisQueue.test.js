// O worker que puxa trabalho do Django. `fetch` e a análise são mockados: o
// assunto aqui é o PROTOCOLO — o que é pedido, o que é devolvido, e o que
// acontece quando cada lado falha.

jest.mock("../services/analysis.service", () => {
  class UnanalyzableGameError extends Error {
    constructor(message) {
      super(message);
      this.terminal = true;
    }
  }
  return {
    analyzeGame: jest.fn(),
    UnanalyzableGameError,
  };
});

// Preenchidos no beforeEach. Não dá para desestruturar no topo: cada teste
// recarrega os módulos (`jest.resetModules`) para poder mexer no ambiente, e
// isso cria uma instância NOVA do mock — a referência antiga passaria a apontar
// para um mock que ninguém mais usa.
let analyzeGame;
let UnanalyzableGameError;

const WORK = {
  analysis_id: 42,
  game_public_id: "0f3a1b2c-0000-0000-0000-000000000001",
  moves: ["e4", "e5"],
  initial_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  result: "white",
  mode: "online",
  max_plies: 300,
  lease_seconds: 900,
};

const REPORT = {
  moves: [{ ply: 1, san: "e4", cp_loss: 0, classification: "best" }],
  counts: { white: {}, black: {} },
  white_accuracy: 99.1,
  black_accuracy: 72.4,
  turning_point_ply: null,
  analyzed_plies: 2,
  engine_depth: 12,
  engine_movetime: 400,
};

let queue;

function loadQueue() {
  jest.resetModules();
  process.env.INTERNAL_API_SECRET = "test-secret";
  process.env.BACKEND_URL = "http://backend:8000";
  queue = require("../services/analysisQueue");
  // A MESMA instância do mock que o worker recém-carregado usa.
  ({ analyzeGame, UnanalyzableGameError } = require("../services/analysis.service"));
}

/** Respostas de `fetch`, na ordem em que serão consumidas. */
function mockFetch(...responses) {
  global.fetch = jest.fn();
  for (const response of responses) {
    global.fetch.mockResolvedValueOnce(response);
  }
  return global.fetch;
}

const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const noContent = () => ({ ok: true, status: 204, json: async () => null });

beforeEach(() => {
  loadQueue();
  analyzeGame.mockReset();
});

afterEach(() => {
  queue.stopAnalysisWorker();
  jest.restoreAllMocks();
});

describe("pedir trabalho", () => {
  test("204 significa 'nada a fazer', não erro", async () => {
    mockFetch(noContent());

    expect(await queue.claimWork()).toBeNull();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/auth/internal/analysis/next/");
    expect(options.headers["X-Internal-Secret"]).toBe("test-secret");
  });

  test("200 devolve a partida com os lances no MESMO payload", async () => {
    // Buscar os lances numa segunda chamada esbarraria no aluguel que a
    // primeira acabou de criar.
    mockFetch(jsonRes(WORK));

    const work = await queue.claimWork();

    expect(work.analysis_id).toBe(42);
    expect(work.moves).toEqual(["e4", "e5"]);
  });

  test("backend fora do ar não derruba o worker", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(queue.claimWork()).resolves.toBeNull();
  });

  test("resposta não-2xx é tratada como 'sem trabalho'", async () => {
    mockFetch(jsonRes({ detail: "erro" }, 500));
    await expect(queue.claimWork()).resolves.toBeNull();
  });
});

describe("processar uma partida", () => {
  test("analisa e devolve o resultado com o analysis_id", async () => {
    analyzeGame.mockResolvedValue(REPORT);
    mockFetch(jsonRes(WORK), jsonRes({ status: "pronta" }));

    expect(await queue.processOne()).toBe(true);

    expect(analyzeGame).toHaveBeenCalledWith({
      moves: WORK.moves,
      initialFen: WORK.initial_fen,
      result: "white",
      maxPlies: 300,
    });

    const [url, options] = global.fetch.mock.calls[1];
    expect(url).toContain("/api/v1/auth/internal/analysis/result/");
    const body = JSON.parse(options.body);
    expect(body.analysis_id).toBe(42);
    expect(body.white_accuracy).toBe(99.1);
    expect(body.moves).toHaveLength(1);
  });

  test("sem trabalho, não chama a engine", async () => {
    mockFetch(noContent());

    expect(await queue.processOne()).toBe(false);
    expect(analyzeGame).not.toHaveBeenCalled();
  });

  test("falha TERMINAL é reportada para sair da fila de vez", async () => {
    // Lance ilegal não melhora tentando de novo.
    analyzeGame.mockRejectedValue(
      new UnanalyzableGameError("Lance ilegal no ply 7")
    );
    mockFetch(jsonRes(WORK), jsonRes({ status: "falhou" }));

    await queue.processOne();

    const body = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(body).toMatchObject({
      analysis_id: 42,
      failed: true,
      failure_reason: "Lance ilegal no ply 7",
    });
  });

  test("falha TRANSITÓRIA não é reportada — o aluguel devolve a partida", async () => {
    // Engine morreu no meio. Marcar `falhou` aqui perderia a partida para
    // sempre; deixar o aluguel vencer é o comportamento certo.
    analyzeGame.mockRejectedValue(new Error("Stockfish timeout"));
    mockFetch(jsonRes(WORK));

    await queue.processOne();

    expect(global.fetch).toHaveBeenCalledTimes(1); // só o claim
  });

  test("backend recusando o resultado não derruba o worker", async () => {
    analyzeGame.mockResolvedValue(REPORT);
    mockFetch(jsonRes(WORK), jsonRes({ detail: "erro" }, 500));

    await expect(queue.processOne()).resolves.toBe(true);
  });

  test("avisa quando a análise passou do aluguel", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    // Aluguel de 1ms contra uma análise que leva 20: o Django pode já ter
    // devolvido a partida à fila. O aviso é o sinal de que o aluguel está
    // curto demais para o tamanho das partidas reais.
    analyzeGame.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return REPORT;
    });
    mockFetch(
      jsonRes({ ...WORK, lease_seconds: 0.001 }),
      jsonRes({ status: "pronta" })
    );

    await queue.processOne();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("aluguel"));
    // E reporta assim mesmo — a escrita no Django é idempotente.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("liga/desliga do worker", () => {
  test("desligado por padrão: não agenda nada", () => {
    expect(queue.startAnalysisWorker({ enabled: false })).toBeNull();
  });

  test("sem INTERNAL_API_SECRET não sobe, mesmo habilitado", () => {
    jest.resetModules();
    process.env.INTERNAL_API_SECRET = "";
    const isolated = require("../services/analysisQueue");

    expect(isolated.startAnalysisWorker({ enabled: true })).toBeNull();
  });

  test("habilitado agenda o primeiro tick", () => {
    const timer = queue.startAnalysisWorker({ enabled: true });
    expect(timer).not.toBeNull();
    queue.stopAnalysisWorker();
  });
});
