import renderer, { act } from "react-test-renderer";

import { useCampaignProgress } from "../useCampaignProgress";

let mockToken: string | null = "test-token";
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: mockToken }),
}));

const mockGetCampaignProgress = jest.fn();
jest.mock("@/services/campaign", () => ({
  getCampaignProgress: (...args: unknown[]) => mockGetCampaignProgress(...args),
}));

let api: ReturnType<typeof useCampaignProgress>;
function Harness() {
  api = useCampaignProgress();
  return null;
}

async function mount() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Harness />);
  });
  return tree;
}

beforeEach(() => {
  mockToken = "test-token";
  mockGetCampaignProgress.mockReset();
});

describe("useCampaignProgress", () => {
  it("carrega e expõe o progresso em caso de sucesso", async () => {
    const payload = [
      { nivel: "beginner", desbloqueado: true, vitorias: 2, vitorias_para_desbloquear: 3, selo_concedido: false },
    ];
    mockGetCampaignProgress.mockResolvedValue(payload);

    await mount();

    expect(api.loading).toBe(false);
    expect(api.error).toBeNull();
    expect(api.progress).toEqual(payload);
  });

  it("preserva a mensagem de erro real, nunca engole em silêncio", async () => {
    mockGetCampaignProgress.mockRejectedValue(new Error("Sem conexão"));

    await mount();

    expect(api.loading).toBe(false);
    expect(api.error).toBe("Sem conexão");
    expect(api.progress).toBeNull();
  });

  it("refresh() busca de novo", async () => {
    mockGetCampaignProgress.mockResolvedValue([]);
    await mount();
    expect(mockGetCampaignProgress).toHaveBeenCalledTimes(1);

    await act(async () => {
      await api.refresh();
    });
    expect(mockGetCampaignProgress).toHaveBeenCalledTimes(2);
  });

  it("sem token não chama o serviço", async () => {
    mockToken = null;
    await mount();
    expect(mockGetCampaignProgress).not.toHaveBeenCalled();
  });
});
