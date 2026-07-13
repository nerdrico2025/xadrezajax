import {
  DailyPuzzleLimitError,
  difficultyForRating,
  getNextPuzzle,
} from "../puzzles";

describe("difficultyForRating — thresholds do PLANO_FASE0 §2", () => {
  it("abaixo de 1000 é easy", () => {
    expect(difficultyForRating(800)).toBe("easy");
    expect(difficultyForRating(999)).toBe("easy");
  });

  it("entre 1000 e 1400 é medium", () => {
    expect(difficultyForRating(1000)).toBe("medium");
    expect(difficultyForRating(1400)).toBe("medium");
  });

  it("acima de 1400 é hard", () => {
    expect(difficultyForRating(1401)).toBe("hard");
    expect(difficultyForRating(1900)).toBe("hard");
  });
});

describe("getNextPuzzle — mapeamento do gating", () => {
  afterEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockRestore?.();
  });

  it("403 com code daily_limit_reached vira DailyPuzzleLimitError", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ code: "daily_limit_reached" }),
    }) as unknown as typeof fetch;

    await expect(getNextPuzzle("token", "easy")).rejects.toBeInstanceOf(
      DailyPuzzleLimitError
    );
  });

  it("outros erros viram Error genérico", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    await expect(getNextPuzzle("token", "easy")).rejects.toThrow(
      "Falha ao carregar o próximo puzzle"
    );
  });
});
