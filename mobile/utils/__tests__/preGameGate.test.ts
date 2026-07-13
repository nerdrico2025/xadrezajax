import { checkAiGameAllowed } from "../preGameGate";

const mockCanPlayGame = jest.fn();
jest.mock("@/services/payments", () => ({
  canPlayGame: (...args: unknown[]) => mockCanPlayGame(...args),
}));

beforeEach(() => jest.clearAllMocks());

describe("gating pré-jogo vs IA (bloqueio antes de o tabuleiro abrir)", () => {
  it("usuário no limite é bloqueado com código mapeável p/ upgrade", async () => {
    mockCanPlayGame.mockResolvedValue({
      can_play: false,
      remaining_games_today: 0,
      code: "daily_limit_reached",
    });

    const gate = await checkAiGameAllowed("token", 300);
    expect(gate).toEqual({ allowed: false, code: "daily_limit_reached" });
    expect(mockCanPlayGame).toHaveBeenCalledWith("token");
  });

  it("usuário com partidas restantes (ou plano pago) joga normalmente", async () => {
    mockCanPlayGame.mockResolvedValue({
      can_play: true,
      remaining_games_today: null,
      code: null,
    });
    expect(await checkAiGameAllowed("token", 180)).toEqual({ allowed: true });
  });

  it("partida sem relógio (não-rateada, PR #68) nunca é gateada", async () => {
    const gate = await checkAiGameAllowed("token", null);
    expect(gate).toEqual({ allowed: true });
    expect(mockCanPlayGame).not.toHaveBeenCalled();
  });

  it("fail-open: falha de rede não bloqueia (defesa fica no backend)", async () => {
    mockCanPlayGame.mockRejectedValue(new Error("offline"));
    expect(await checkAiGameAllowed("token", 300)).toEqual({ allowed: true });
  });

  it("sem token não consulta nem bloqueia", async () => {
    expect(await checkAiGameAllowed(null, 300)).toEqual({ allowed: true });
    expect(mockCanPlayGame).not.toHaveBeenCalled();
  });
});
