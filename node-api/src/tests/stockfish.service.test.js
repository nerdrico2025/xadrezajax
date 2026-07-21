// Calibragem da IA (rodada de UX pós-Campanha, item 2): o erro injetado nos
// níveis fracos é escolhido por JANELA DE PERDA em centipawns, não por índice
// de linha do MultiPV — ver o cabeçalho de stockfish.service.js para o porquê.
//
// Estes testes cobrem a LÓGICA pura (sem binário stockfish, que o CI não
// instala). A validação empírica com a engine real vive em
// scripts/validate-cp-loss.js.

const EventEmitter = require("events");

function fakeEngine() {
  const engine = new EventEmitter();
  engine.stdout = new EventEmitter();
  engine.stderr = new EventEmitter();
  engine.stdin = { write: jest.fn() };
  engine.kill = jest.fn();
  return engine;
}

/** Linha de MultiPV no formato que o parser produz. */
function line(index, move, cp, mate = null) {
  return { index, move, cp, mate };
}

describe("parseMultipvLine — extração de lance e avaliação", () => {
  let parseMultipvLine;

  beforeEach(() => {
    jest.resetModules();
    ({ parseMultipvLine } = require("../services/stockfish.service"));
  });

  test("extrai index, lance e score cp", () => {
    const raw =
      "info depth 4 seldepth 5 multipv 2 score cp -30 nodes 20 pv e7e5 g1f3";
    expect(parseMultipvLine(raw)).toEqual({
      index: 2,
      move: "e7e5",
      cp: -30,
      mate: null,
    });
  });

  test("extrai score mate (positivo e negativo)", () => {
    const aFavor = "info depth 4 multipv 1 score mate 2 pv d8h4";
    const contra = "info depth 4 multipv 7 score mate -2 pv d8g5";
    expect(parseMultipvLine(aFavor)).toMatchObject({ mate: 2, cp: null });
    expect(parseMultipvLine(contra)).toMatchObject({ mate: -2, cp: null });
  });

  test("retorna null para linha sem multipv ou sem pv", () => {
    expect(parseMultipvLine("info depth 1 score cp 10")).toBeNull();
    expect(parseMultipvLine("uciok")).toBeNull();
  });
});

describe("pickMove — janela de erro (piso, teto e anti-catástrofe)", () => {
  let pickMove;

  beforeEach(() => {
    jest.resetModules();
    ({ pickMove } = require("../services/stockfish.service"));
  });

  afterEach(() => {
    if (Math.random.mockRestore) Math.random.mockRestore();
  });

  test("sem janela (Mestre) sempre joga o bestmove do engine", () => {
    const lines = { 1: line(1, "e2e4", 50), 2: line(2, "d2d4", -400) };
    jest.spyOn(Math, "random").mockReturnValue(0);
    expect(pickMove("e2e4", lines, null)).toBe("e2e4");
  });

  test("sorteio acima da chance de erro joga o bestmove", () => {
    const lines = { 1: line(1, "e2e4", 50), 2: line(2, "d2d4", -150) };
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    const move = pickMove("e2e4", lines, {
      blunderChance: 0.8,
      minLoss: 100,
      maxLoss: 600,
    });
    expect(move).toBe("e2e4");
  });

  test("erra dentro da janela: escolhe linha que perde entre minLoss e maxLoss", () => {
    const lines = {
      1: line(1, "melhor", 100),
      2: line(2, "quase", 80), // perde 20 — abaixo do piso
      3: line(3, "erro_bom", -100), // perde 200 — dentro
      4: line(4, "erro_grande", -700), // perde 800 — acima do teto
    };
    jest.spyOn(Math, "random").mockReturnValue(0);
    const move = pickMove("melhor", lines, {
      blunderChance: 1,
      minLoss: 150,
      maxLoss: 500,
    });
    expect(move).toBe("erro_bom");
  });

  test("NUNCA escolhe linha que entrega mate contra (anti-catástrofe)", () => {
    const lines = {
      1: line(1, "melhor", 100),
      2: line(2, "suicida", null, -2), // mate em 2 contra
      3: line(3, "suicida2", null, -1),
    };
    jest.spyOn(Math, "random").mockReturnValue(0);
    const move = pickMove("melhor", lines, {
      blunderChance: 1,
      minLoss: 50,
      maxLoss: 5000,
    });
    // Sem candidato seguro na janela → volta para o bestmove, nunca o mate.
    expect(move).toBe("melhor");
  });

  test("respeita o teto: não escolhe erro acima de maxLoss", () => {
    const lines = {
      1: line(1, "melhor", 100),
      2: line(2, "catastrofe", -2000), // perde 2100
    };
    jest.spyOn(Math, "random").mockReturnValue(0);
    const move = pickMove("melhor", lines, {
      blunderChance: 1,
      minLoss: 100,
      maxLoss: 600,
    });
    expect(move).toBe("melhor");
  });

  test("fallback em posição quieta: joga a pior linha segura disponível", () => {
    // Nenhuma linha atinge o piso de 150 — deve pegar a que mais perde (30).
    const lines = {
      1: line(1, "melhor", 100),
      2: line(2, "ok", 90), // perde 10
      3: line(3, "pior_segura", 70), // perde 30
    };
    jest.spyOn(Math, "random").mockReturnValue(0);
    const move = pickMove("melhor", lines, {
      blunderChance: 1,
      minLoss: 150,
      maxLoss: 600,
    });
    expect(move).toBe("pior_segura");
  });

  test("linha 1 com mate a favor não impede a escolha (score normalizado)", () => {
    const lines = {
      1: line(1, "mata", null, 2),
      2: line(2, "nao_mata", 300),
    };
    jest.spyOn(Math, "random").mockReturnValue(0);
    // Perda de "nao_mata" = 10000 - 300 = 9700 → acima de qualquer teto são.
    const move = pickMove("mata", lines, {
      blunderChance: 1,
      minLoss: 100,
      maxLoss: 900,
    });
    expect(move).toBe("mata");
  });
});

describe("curva de dificuldade — parâmetros por nível", () => {
  let LEVELS, ERROR_WINDOWS, LEVEL_ORDER;

  beforeEach(() => {
    jest.resetModules();
    ({ LEVELS, ERROR_WINDOWS, LEVEL_ORDER } = require("../services/stockfish.service"));
  });

  test("os 5 níveis existem na ordem do mais fraco ao mais forte", () => {
    expect(LEVEL_ORDER).toEqual(["beginner", "easy", "medium", "hard", "master"]);
    for (const level of LEVEL_ORDER) expect(LEVELS[level]).toBeDefined();
  });

  test("Mestre joga força total: sem janela de erro", () => {
    expect(ERROR_WINDOWS.master).toBeNull();
  });

  test("monotonicidade da chance de erro: erra menos conforme sobe o nível", () => {
    const chances = ["beginner", "easy", "medium", "hard"].map(
      (l) => ERROR_WINDOWS[l].blunderChance
    );
    for (let i = 1; i < chances.length; i++) {
      expect(chances[i]).toBeLessThan(chances[i - 1]);
    }
  });

  test("monotonicidade do tamanho do erro: níveis fracos erram mais caro", () => {
    const pisos = ["beginner", "easy", "medium", "hard"].map(
      (l) => ERROR_WINDOWS[l].minLoss
    );
    const tetos = ["beginner", "easy", "medium", "hard"].map(
      (l) => ERROR_WINDOWS[l].maxLoss
    );
    for (let i = 1; i < pisos.length; i++) {
      expect(pisos[i]).toBeLessThan(pisos[i - 1]);
      expect(tetos[i]).toBeLessThan(tetos[i - 1]);
    }
  });

  test("níveis fracos pedem MultiPV alto (senão não há erro para escolher)", () => {
    // A calibragem anterior falhou por MultiPV 4 em depth 1: as linhas eram
    // todas equivalentes. O Iniciante precisa de material ruim disponível.
    expect(LEVELS.beginner.multipv).toBeGreaterThanOrEqual(12);
    expect(LEVELS.easy.multipv).toBeGreaterThanOrEqual(8);
    expect(LEVELS.master.multipv).toBe(1);
  });

  test("profundidade e tempo crescem com o nível", () => {
    const depths = LEVEL_ORDER.map((l) => LEVELS[l].depth);
    const times = LEVEL_ORDER.map((l) => LEVELS[l].movetime);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });
});

describe("resolveLevel — resolução de dificuldade", () => {
  let resolveLevel;

  beforeEach(() => {
    jest.resetModules();
    ({ resolveLevel } = require("../services/stockfish.service"));
  });

  test("nível conhecido traz limites + janela de erro", () => {
    const r = resolveLevel("beginner");
    expect(r.skill).toBe(0);
    expect(r.errorWindow).toMatchObject({ minLoss: expect.any(Number) });
  });

  test("Mestre resolve com errorWindow null", () => {
    expect(resolveLevel("master").errorWindow).toBeNull();
  });

  test("contrato legado (número = depth) joga força máxima sem janela", () => {
    const r = resolveLevel(6);
    expect(r).toMatchObject({ skill: 20, depth: 6, errorWindow: null });
  });

  test("desconhecido cai no nível padrão", () => {
    expect(resolveLevel(undefined).skill).toBe(resolveLevel("medium").skill);
  });
});

describe("getBestMove — integração com o processo da engine (mockada)", () => {
  let getBestMove;
  let engine;

  beforeEach(() => {
    jest.resetModules();
    engine = fakeEngine();
    jest.doMock("child_process", () => ({ spawn: jest.fn(() => engine) }));
    ({ getBestMove } = require("../services/stockfish.service"));
  });

  afterEach(() => {
    jest.dontMock("child_process");
    if (Math.random.mockRestore) Math.random.mockRestore();
  });

  test("beginner configura MultiPV alto via setoption", async () => {
    const promise = getBestMove("fen", "beginner");
    expect(engine.stdin.write).toHaveBeenCalledWith(
      "setoption name MultiPV value 16\n"
    );
    engine.stdout.emit("data", Buffer.from("bestmove e2e4\n"));
    await promise;
  });

  test("master NÃO configura MultiPV (força total, linha única)", async () => {
    const promise = getBestMove("fen", "master");
    const multipvCalls = engine.stdin.write.mock.calls.filter(([cmd]) =>
      cmd.includes("MultiPV")
    );
    expect(multipvCalls).toHaveLength(0);
    engine.stdout.emit("data", Buffer.from("bestmove e2e4\n"));
    expect(await promise).toBe("e2e4");
  });

  test("beginner joga linha inferior quando o sorteio dispara o erro", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const promise = getBestMove("fen", "beginner");

    engine.stdout.emit(
      "data",
      Buffer.from(
        "info depth 4 multipv 1 score cp 100 pv e2e4\n" +
          "info depth 4 multipv 2 score cp -120 pv a2a3\n" +
          "info depth 4 multipv 3 score cp -180 pv h2h4\n"
      )
    );
    engine.stdout.emit("data", Buffer.from("bestmove e2e4\n"));

    const move = await promise;
    // Ambas as alternativas perdem entre 150 e 900cp → janela do Iniciante.
    expect(["a2a3", "h2h4"]).toContain(move);
  });

  test("beginner nunca escolhe a linha que entrega mate contra", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const promise = getBestMove("fen", "beginner");

    engine.stdout.emit(
      "data",
      Buffer.from(
        "info depth 4 multipv 1 score cp 100 pv e2e4\n" +
          "info depth 4 multipv 2 score cp -200 pv a2a3\n" +
          "info depth 4 multipv 3 score mate -2 pv g2g4\n"
      )
    );
    engine.stdout.emit("data", Buffer.from("bestmove e2e4\n"));

    expect(await promise).not.toBe("g2g4");
  });

  test("propaga null quando a engine não devolve lance", async () => {
    const promise = getBestMove("fen", "medium");
    engine.stdout.emit("data", Buffer.from("bestmove\n"));
    expect(await promise).toBeNull();
  });
});
