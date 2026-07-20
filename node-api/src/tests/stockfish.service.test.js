// Rodada 2, item 3: Iniciante/Fácil enfraquecidos via MultiPV + escolha
// subótima (decisão de produto — nunca erro aleatório puro/lance absurdo).
// getBestMove usa o binário `stockfish` real via child_process.spawn; aqui
// mockamos o spawn para testar a lógica de escolha isolada da engine.

const EventEmitter = require("events");

function fakeEngine() {
  const engine = new EventEmitter();
  engine.stdout = new EventEmitter();
  engine.stderr = new EventEmitter();
  engine.stdin = { write: jest.fn() };
  engine.kill = jest.fn();
  return engine;
}

describe("stockfish.service — parseMultipvLine / pickMove", () => {
  let parseMultipvLine;
  let pickMove;

  beforeEach(() => {
    jest.resetModules();
    ({ parseMultipvLine, pickMove } = require("../services/stockfish.service"));
  });

  test("extrai index e lance de uma linha info multipv válida", () => {
    const line =
      "info depth 1 seldepth 1 multipv 2 score cp -30 nodes 20 pv e7e5 g1f3";
    expect(parseMultipvLine(line)).toEqual({ index: 2, move: "e7e5" });
  });

  test("retorna null para linha sem multipv ou sem pv", () => {
    expect(parseMultipvLine("info depth 1 score cp 10")).toBeNull();
    expect(parseMultipvLine("uciok")).toBeNull();
  });

  test("pickMove sem subOptimalChance sempre devolve o melhor lance", () => {
    const pvLines = { 1: "e2e4", 2: "d2d4", 3: "c2c4" };
    expect(pickMove("e2e4", pvLines, 0)).toBe("e2e4");
  });

  test("pickMove com chance 1 e alternativas disponíveis escolhe uma linha inferior", () => {
    const pvLines = { 1: "e2e4", 2: "d2d4" };
    jest.spyOn(Math, "random").mockReturnValue(0); // < subOptimalChance e primeiro índice do sorteio
    const chosen = pickMove("e2e4", pvLines, 1);
    expect(chosen).toBe("d2d4");
    Math.random.mockRestore();
  });

  test("pickMove cai no melhor lance se não houver alternativas capturadas", () => {
    const pvLines = { 1: "e2e4" };
    jest.spyOn(Math, "random").mockReturnValue(0);
    expect(pickMove("e2e4", pvLines, 1)).toBe("e2e4");
    Math.random.mockRestore();
  });
});

describe("stockfish.service — LEVELS (calibragem por nível)", () => {
  let LEVELS;

  beforeEach(() => {
    jest.resetModules();
    ({ LEVELS } = require("../services/stockfish.service"));
  });

  test("Iniciante e Fácil têm MultiPV + chance subótima configurados", () => {
    expect(LEVELS.beginner.multipv).toBeGreaterThan(1);
    expect(LEVELS.beginner.subOptimalChance).toBeGreaterThan(0);
    expect(LEVELS.easy.multipv).toBeGreaterThan(1);
    expect(LEVELS.easy.subOptimalChance).toBeGreaterThan(0);
    // Iniciante deve ser >= Fácil em chance de jogar subótimo (mais fraco).
    expect(LEVELS.beginner.subOptimalChance).toBeGreaterThanOrEqual(
      LEVELS.easy.subOptimalChance
    );
  });

  test("Médio, Difícil e Mestre continuam na força total (sem MultiPV)", () => {
    expect(LEVELS.medium.multipv).toBeUndefined();
    expect(LEVELS.hard.multipv).toBeUndefined();
    expect(LEVELS.master.multipv).toBeUndefined();
    expect(LEVELS.medium.subOptimalChance).toBeUndefined();
    expect(LEVELS.hard.subOptimalChance).toBeUndefined();
    expect(LEVELS.master.subOptimalChance).toBeUndefined();
  });
});

describe("stockfish.service — getBestMove (engine mockada)", () => {
  let getBestMove;
  let spawnMock;
  let engine;

  beforeEach(() => {
    jest.resetModules();
    engine = fakeEngine();
    spawnMock = jest.fn(() => engine);
    jest.doMock("child_process", () => ({ spawn: spawnMock }));
    ({ getBestMove } = require("../services/stockfish.service"));
  });

  afterEach(() => {
    jest.dontMock("child_process");
    if (Math.random.mockRestore) Math.random.mockRestore();
  });

  function emitBestMove(move) {
    engine.stdout.emit("data", Buffer.from(`bestmove ${move}\n`));
  }

  test("beginner configura MultiPV via setoption", async () => {
    const promise = getBestMove("fen-qualquer", "beginner");
    expect(engine.stdin.write).toHaveBeenCalledWith(
      "setoption name MultiPV value 4\n"
    );
    emitBestMove("e2e4");
    await promise;
  });

  test("medium NÃO configura MultiPV (força total inalterada)", async () => {
    const promise = getBestMove("fen-qualquer", "medium");
    const multipvCalls = engine.stdin.write.mock.calls.filter(([cmd]) =>
      cmd.includes("MultiPV")
    );
    expect(multipvCalls).toHaveLength(0);
    emitBestMove("e2e4");
    await promise;
  });

  test("beginner escolhe uma linha inferior quando o sorteio força subótimo", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const promise = getBestMove("fen-qualquer", "beginner");

    engine.stdout.emit(
      "data",
      Buffer.from(
        "info depth 1 multipv 1 score cp 50 pv e2e4\n" +
          "info depth 1 multipv 2 score cp 10 pv d2d4\n" +
          "info depth 1 multipv 3 score cp -5 pv c2c4\n"
      )
    );
    emitBestMove("e2e4");

    const move = await promise;
    // Math.random forçado a 0: subOptimalChance>0 sempre dispara, e o
    // primeiro índice do array de alternativas é escolhido.
    expect(["d2d4", "c2c4"]).toContain(move);
  });

  test("medium sempre devolve o bestmove reportado pela engine", async () => {
    const promise = getBestMove("fen-qualquer", "medium");
    engine.stdout.emit(
      "data",
      Buffer.from("info depth 4 score cp 50 pv e2e4\n")
    );
    emitBestMove("e2e4");
    const move = await promise;
    expect(move).toBe("e2e4");
  });
});
