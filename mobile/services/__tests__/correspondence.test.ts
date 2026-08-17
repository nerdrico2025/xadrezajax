import {
  listCorrespondenceGames,
  createChallenge,
  joinMatchmaking,
  submitCorrespondenceMove,
  CorrespondenceApiError,
} from "../correspondence";

function mockFetch(response: Partial<Response> & { json?: () => Promise<any> }) {
  global.fetch = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

afterEach(() => {
  (global.fetch as jest.Mock | undefined)?.mockRestore?.();
});

describe("listCorrespondenceGames", () => {
  it("retorna a lista em caso de sucesso", async () => {
    const payload = [{ id: 1, status: "active" }];
    mockFetch({ ok: true, json: () => Promise.resolve(payload) } as any);

    const result = await listCorrespondenceGames("token");
    expect(result).toEqual(payload);
  });

  it("erro de rede vira Error com fallback e status", async () => {
    mockFetch({ ok: false, status: 500, json: () => Promise.resolve({}) } as any);

    await expect(listCorrespondenceGames("token")).rejects.toThrow(
      "Falha ao carregar as partidas (erro 500)"
    );
  });
});

describe("createChallenge", () => {
  it("erro de negócio (limite) vira CorrespondenceApiError com code e a mensagem exata do backend", async () => {
    mockFetch({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          detail: "Você já tem 2 partidas do Modo Turno em andamento.",
          code: "limit",
        }),
    } as any);

    try {
      await createChallenge("token", "bob", 3);
      fail("deveria ter lançado");
    } catch (e) {
      expect(e).toBeInstanceOf(CorrespondenceApiError);
      expect((e as CorrespondenceApiError).code).toBe("limit");
      expect((e as CorrespondenceApiError).message).toBe(
        "Você já tem 2 partidas do Modo Turno em andamento."
      );
    }
  });

  it("sucesso devolve a partida criada", async () => {
    const payload = { id: 9, status: "pending" };
    mockFetch({ ok: true, json: () => Promise.resolve(payload) } as any);

    const result = await createChallenge("token", "bob", 1);
    expect(result).toEqual(payload);
  });
});

describe("joinMatchmaking", () => {
  it("queued=true não devolve partida", async () => {
    mockFetch({ ok: true, json: () => Promise.resolve({ queued: true }) } as any);
    const result = await joinMatchmaking("token", 1);
    expect(result).toEqual({ queued: true, game: null });
  });

  it("pareamento instantâneo devolve a partida ativa", async () => {
    const payload = { id: 5, status: "active", queued: false };
    mockFetch({ ok: true, json: () => Promise.resolve(payload) } as any);
    const result = await joinMatchmaking("token", 1);
    expect(result.queued).toBe(false);
    expect(result.game).toMatchObject({ id: 5, status: "active" });
  });
});

describe("submitCorrespondenceMove", () => {
  it("lance ilegal vira CorrespondenceApiError com code 'illegal'", async () => {
    mockFetch({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ detail: "Lance inválido.", code: "illegal" }),
    } as any);

    await expect(submitCorrespondenceMove("token", 1, "e2e5")).rejects.toMatchObject({
      code: "illegal",
      message: "Lance inválido.",
    });
  });

  it("lance aceito devolve a partida atualizada", async () => {
    const payload = { id: 1, fen: "novo-fen", moves: ["e4"] };
    mockFetch({ ok: true, json: () => Promise.resolve(payload) } as any);
    const result = await submitCorrespondenceMove("token", 1, "e2e4");
    expect(result).toEqual(payload);
  });
});
