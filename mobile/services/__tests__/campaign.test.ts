import { getCampaignProgress } from "../campaign";

describe("getCampaignProgress", () => {
  afterEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockRestore?.();
  });

  it("retorna os 5 níveis em caso de sucesso", async () => {
    const payload = [
      { nivel: "beginner", desbloqueado: true, vitorias: 1, vitorias_para_desbloquear: 3, selo_concedido: false },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    }) as unknown as typeof fetch;

    const result = await getCampaignProgress("token");
    expect(result).toEqual(payload);
  });

  it("erro vira Error com a mensagem real (fallback com status)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    await expect(getCampaignProgress("token")).rejects.toThrow(
      "Falha ao carregar o progresso da campanha (erro 500)"
    );
  });
});
