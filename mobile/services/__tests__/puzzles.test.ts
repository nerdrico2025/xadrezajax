import {
  NoPuzzlesAvailableError,
  TrainingRequiresPremiumError,
  difficultyForRating,
  getDailyPuzzle,
  getNextPuzzle,
  reportPuzzleProgress,
} from "../puzzles";

function mockFetch(response: {
  ok: boolean;
  status?: number;
  json?: unknown;
}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: () => Promise.resolve(response.json ?? {}),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  (global.fetch as jest.Mock | undefined)?.mockRestore?.();
});

describe("difficultyForRating — só vale no Treino (o diário é o mesmo p/ todos)", () => {
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

describe("getDailyPuzzle — grátis para todos", () => {
  it("devolve o problema do dia com o estado de tentativas", async () => {
    mockFetch({
      ok: true,
      json: {
        id: 1,
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        solution: ["a1a8"],
        exhausted: false,
        attempts_used: 1,
        attempts_left: 3,
        max_attempts: 4,
      },
    });

    const daily = await getDailyPuzzle("token");
    expect(daily.id).toBe(1);
    expect(daily.attempts_left).toBe(3);
    expect(daily.max_attempts).toBe(4);
  });

  it("esgotado vem sem a solução (o servidor não entrega a resposta)", async () => {
    mockFetch({
      ok: true,
      json: { id: 1, exhausted: true, attempts_used: 4, attempts_left: 0 },
    });

    const daily = await getDailyPuzzle("token");
    expect(daily.exhausted).toBe(true);
    expect(daily.solution).toBeUndefined();
  });

  it("banco vazio vira NoPuzzlesAvailableError", async () => {
    mockFetch({ ok: false, status: 404 });
    await expect(getDailyPuzzle("token")).rejects.toBeInstanceOf(
      NoPuzzlesAvailableError
    );
  });
});

describe("getNextPuzzle — Treino exige plano pago", () => {
  it("403 training_requires_premium vira TrainingRequiresPremiumError", async () => {
    mockFetch({
      ok: false,
      status: 403,
      json: { code: "training_requires_premium" },
    });

    await expect(getNextPuzzle("token", "easy")).rejects.toBeInstanceOf(
      TrainingRequiresPremiumError
    );
  });

  it("404 vira NoPuzzlesAvailableError", async () => {
    mockFetch({ ok: false, status: 404 });
    await expect(getNextPuzzle("token", "easy")).rejects.toBeInstanceOf(
      NoPuzzlesAvailableError
    );
  });

  it("outros erros viram Error genérico com a causa", async () => {
    mockFetch({ ok: false, status: 500 });
    await expect(getNextPuzzle("token", "easy")).rejects.toThrow(
      "Falha ao carregar o próximo problema (erro 500)"
    );
  });
});

describe("reportPuzzleProgress", () => {
  it("devolve o estado de tentativas no modo diário", async () => {
    mockFetch({
      ok: true,
      json: {
        puzzle_id: 1,
        solved: false,
        attempts: 2,
        mode: "daily",
        attempts_used: 2,
        attempts_left: 2,
        exhausted: false,
      },
    });

    const result = await reportPuzzleProgress("token", 1, false, 1);
    expect(result.mode).toBe("daily");
    expect(result.attempts_left).toBe(2);
  });

  it("403 do treino também é mapeado aqui (defesa do gating)", async () => {
    mockFetch({
      ok: false,
      status: 403,
      json: { code: "training_requires_premium" },
    });

    await expect(reportPuzzleProgress("token", 9, true, 1)).rejects.toBeInstanceOf(
      TrainingRequiresPremiumError
    );
  });
});
