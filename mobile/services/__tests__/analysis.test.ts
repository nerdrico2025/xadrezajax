import { getGameAnalysis, isAnalysisPending } from "../analysis";

jest.mock("@/utils/storage", () => {
  const store = new Map<string, string>([["refreshToken", "refresh-valido"]]);
  return {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItem: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const PUBLIC_ID = "0f3a1b2c-0000-0000-0000-000000000001";

afterEach(() => {
  (global.fetch as jest.Mock | undefined)?.mockRestore?.();
});

describe("isAnalysisPending", () => {
  it("só pendente e analisando merecem nova pergunta", () => {
    expect(isAnalysisPending("pendente")).toBe(true);
    expect(isAnalysisPending("analisando")).toBe(true);
    expect(isAnalysisPending("pronta")).toBe(false);
    expect(isAnalysisPending("falhou")).toBe(false);
    // Estados finais do ponto de vista de quem pergunta: insistir não muda.
    expect(isAnalysisPending("indisponivel")).toBe(false);
    expect(isAnalysisPending("inexistente")).toBe(false);
  });
});

describe("getGameAnalysis", () => {
  it("busca a análise da partida pelo public_id, autenticada", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "pronta", moves: [] }),
    }) as unknown as typeof fetch;

    const result = await getGameAnalysis("token-de-acesso", PUBLIC_ID);

    expect(result.status).toBe("pronta");
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain(`/api/v1/auth/games/${PUBLIC_ID}/analysis/`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-de-acesso"
    );
  });

  it("erro do servidor vira Error, não resposta silenciosa", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(getGameAnalysis("t", PUBLIC_ID)).rejects.toThrow(
      "Falha ao carregar a análise"
    );
  });
});
