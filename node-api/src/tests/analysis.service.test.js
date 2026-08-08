// Orquestração da análise: replay da partida, recuo diante das partidas ao
// vivo, teto de plies e montagem do relatório.
//
// A engine é FALSA aqui — o binário do Stockfish não existe no CI, e o que
// importa nestes testes é a mecânica em volta dele. A matemática tem suíte
// própria (analysisMath.test.js).

jest.mock("../services/stockfish.service", () => ({
  // Reaproveita o parser de verdade: ele é puro e é o contrato entre a engine
  // e o cálculo.
  parseMultipvLine: jest.requireActual("../services/stockfish.service.js")
    .parseMultipvLine,
  poolStats: jest.fn(() => ({ waiting: 0 })),
}));

const {
  replay,
  buildReport,
  waitForLiveIdle,
  analyzeGame,
  UnanalyzableGameError,
} = require("../services/analysis.service");
const { poolStats } = require("../services/stockfish.service");

// Mate do pastor: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
const SCHOLARS = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];

afterEach(() => jest.clearAllMocks());

describe("replay dos lances", () => {
  test("reconstrói a partida e alterna as cores", () => {
    const positions = replay(SCHOLARS);

    expect(positions).toHaveLength(SCHOLARS.length);
    expect(positions[0]).toMatchObject({ ply: 1, san: "e4", color: "w" });
    expect(positions[1]).toMatchObject({ ply: 2, san: "e5", color: "b" });
    expect(positions[6]).toMatchObject({ san: "Qxf7#", isCheckmate: true });
  });

  test("cada posição carrega o antes e o depois do lance", () => {
    const [first] = replay(["e4"]);
    expect(first.fenBefore).toContain(" w ");
    expect(first.fenAfter).toContain(" b ");
  });

  test("lance ILEGAL vira erro terminal com o ply no motivo", () => {
    // É a única validação de legalidade que existe: partida vs IA chega com
    // lances que o servidor nunca viu (o Django não tem biblioteca de xadrez).
    expect(() => replay(["e4", "e5", "Qxf7#"])).toThrow(UnanalyzableGameError);
    try {
      replay(["e4", "e5", "Qxf7#"]);
    } catch (err) {
      expect(err.message).toContain("ply 3");
      expect(err.terminal).toBe(true);
    }
  });

  test("lixo no lugar de SAN também é rejeitado, não ignorado", () => {
    expect(() => replay(["e4", "não é um lance"])).toThrow(
      UnanalyzableGameError
    );
  });

  test("aceita partida começando de uma FEN informada", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const positions = replay(["e5"], fen);
    expect(positions[0]).toMatchObject({ san: "e5", color: "b" });
  });
});

describe("recuo cooperativo diante das partidas ao vivo", () => {
  test("pool ao vivo livre: segue direto, sem esperar", async () => {
    poolStats.mockReturnValue({ waiting: 0 });
    expect(await waitForLiveIdle()).toBe(0);
  });

  test("com gente esperando engine, a análise sai da frente", async () => {
    // Duas rodadas ocupado, depois libera.
    poolStats
      .mockReturnValueOnce({ waiting: 2 })
      .mockReturnValueOnce({ waiting: 1 })
      .mockReturnValue({ waiting: 0 });

    const rounds = await waitForLiveIdle();

    expect(rounds).toBe(2);
    expect(poolStats).toHaveBeenCalledTimes(3);
  });

  test("telemetria quebrada não trava a análise", async () => {
    poolStats.mockImplementation(() => {
      throw new Error("sem telemetria");
    });
    await expect(waitForLiveIdle()).resolves.toBe(0);
  });
});

describe("montagem do relatório", () => {
  /** Posições do replay + uma avaliação por posição (a última fecha o
   *  cp_loss do último lance). */
  function report(moves, evaluations, result = "white") {
    const positions = replay(moves);
    return buildReport({ positions, evaluations, result, moves });
  }

  /** Avaliação com melhor e segunda linha. */
  const ev = (cp, secondCp = cp - 20, bestMoveUci = null) => ({
    cp,
    secondCp,
    bestMoveUci,
  });

  test("uma entrada por lance, com ply, san e classificação", () => {
    const out = report(["e4", "e5"], [ev(30), ev(-25), ev(20)]);

    expect(out.moves).toHaveLength(2);
    expect(out.moves[0]).toMatchObject({ ply: 1, san: "e4" });
    expect(out.moves[1]).toMatchObject({ ply: 2, san: "e5" });
    expect(out.analyzed_plies).toBe(2);
  });

  test("cor não vaza para o payload do banco", () => {
    // `color` e as probabilidades são de uso interno (momento decisivo); o
    // schema do Django não tem esses campos.
    const out = report(["e4"], [ev(30), ev(-30)]);
    expect(out.moves[0]).not.toHaveProperty("color");
    expect(out.moves[0]).not.toHaveProperty("winBefore");
  });

  test("contagem por classificação é separada por cor", () => {
    const out = report(["e4", "e5"], [ev(30), ev(-25), ev(20)]);
    expect(out.counts.white.best + out.counts.white.good).toBe(1);
    expect(out.counts.black.best + out.counts.black.good).toBe(1);
  });

  test("um blunder das pretas aparece como blunder das pretas", () => {
    // Brancas jogam bem; pretas entregam 400cp no ply 2.
    const out = report(["e4", "e5"], [ev(30), ev(-30), ev(400)]);

    expect(out.moves[1].cp_loss).toBeGreaterThan(300);
    expect(out.moves[1].classification).toBe("blunder");
    expect(out.counts.black.blunder).toBe(1);
    expect(out.counts.white.blunder).toBe(0);
  });

  test("lance preciso de abertura fica na lista mas fora da média", () => {
    const out = report(["e4", "e5"], [ev(30), ev(-30), ev(30)]);

    expect(out.moves[0].is_book).toBe(true);
    expect(out.moves[0].classification).toBe("best");
    // Nenhum lance fora do livro → sem média para calcular.
    expect(out.white_accuracy).toBeNull();
    expect(out.white_avg_loss).toBeNull();
  });

  test("BLUNDER na abertura entra na média — não é teoria", () => {
    // Regressão do que apareceu no teste contra a engine real: no mate do
    // pastor o erro decisivo cai no ply 6, e marcá-lo como livro deixava a
    // vítima sem precisão nenhuma para mostrar.
    const out = report(["e4", "e5"], [ev(30), ev(500), ev(-30)]);

    expect(out.moves[0].is_book).toBe(false);
    expect(out.moves[0].classification).toBe("blunder");
    expect(out.white_accuracy).not.toBeNull();
    expect(out.white_avg_loss).toBeGreaterThan(300);
  });

  test("precisão e perda média saem dos lances fora do livro", () => {
    // 13 plies para atravessar a janela de abertura (12) e sobrar um lance
    // contando para a média.
    const longGame = [
      "e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6",
      "O-O", "Be7", "Re1", "b5", "Bb3",
    ];
    // Partida impecável: a avaliação alterna de sinal a cada posição, que é o
    // que significa "ninguém perdeu nada" (a de quem está para jogar é sempre
    // +30). São N+1 avaliações — a última fecha o cp_loss do último lance.
    const evaluations = Array.from({ length: longGame.length + 1 }, (_, i) =>
      ev(i % 2 === 0 ? 30 : -30)
    );

    const out = report(longGame, evaluations);

    expect(out.white_accuracy).not.toBeNull();
    expect(out.white_accuracy).toBeCloseTo(100, 0);
    expect(out.white_avg_loss).toBe(0);
  });

  test("melhor lance vem em SAN, não em UCI", () => {
    const out = report(["e4"], [ev(30, 10, "d2d4"), ev(-30)]);
    expect(out.moves[0].best_move_san).toBe("d4");
  });

  test("melhor lance ausente não quebra a entrada", () => {
    const out = report(["e4"], [ev(30, 10, null), ev(-30)]);
    expect(out.moves[0].best_move_san).toBe("");
  });

  test("momento decisivo sai junto do relatório", () => {
    // Pretas em vantagem que vira derrota no ply 2.
    const out = report(["e4", "e5"], [ev(0), ev(60), ev(600)], "white");
    expect(out.turning_point_ply).toBe(2);
  });

  test("partida sem virada devolve momento decisivo nulo", () => {
    const out = report(["e4", "e5"], [ev(600), ev(-600), ev(650)], "white");
    expect(out.turning_point_ply).toBeNull();
  });

  test("os parâmetros da engine vão no relatório (reprodutibilidade)", () => {
    const out = report(["e4"], [ev(30), ev(-30)]);
    expect(out.engine_depth).toBe(12);
    expect(out.engine_movetime).toBe(400);
  });
});

describe("analyzeGame — teto de plies e entradas inválidas", () => {
  test("partida sem lances é erro terminal", async () => {
    await expect(analyzeGame({ moves: [] })).rejects.toThrow(
      UnanalyzableGameError
    );
    await expect(analyzeGame({ moves: null })).rejects.toThrow(
      UnanalyzableGameError
    );
  });

  test("lance ilegal é erro terminal antes de gastar engine", async () => {
    // O replay acontece ANTES do acquire: partida impossível não chega a
    // ocupar um engine.
    await expect(
      analyzeGame({ moves: ["e4", "e5", "Qxf7#"], maxPlies: 300 })
    ).rejects.toThrow(UnanalyzableGameError);
  });
});
