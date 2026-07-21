import {
  currentCampaignLevel,
  highestUnlockedLevel,
  resolvePreselectedLevel,
} from "../campaignHelpers";
import type { CampaignLevelProgress } from "@/services/campaign";

function buildProgress(
  overrides: Partial<Record<string, Partial<CampaignLevelProgress>>> = {}
): CampaignLevelProgress[] {
  const base: CampaignLevelProgress[] = [
    { nivel: "beginner", desbloqueado: true, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
    { nivel: "easy", desbloqueado: false, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
    { nivel: "medium", desbloqueado: false, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
    { nivel: "hard", desbloqueado: false, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
    { nivel: "master", desbloqueado: false, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
  ];
  return base.map((row) => ({ ...row, ...(overrides[row.nivel] ?? {}) }));
}

describe("highestUnlockedLevel", () => {
  it("estado inicial: só Iniciante desbloqueado", () => {
    expect(highestUnlockedLevel(buildProgress())).toBe("beginner");
  });

  it("retorna o último desbloqueado na ordem sequencial", () => {
    const progress = buildProgress({
      easy: { desbloqueado: true },
      medium: { desbloqueado: true },
    });
    expect(highestUnlockedLevel(progress)).toBe("medium");
  });
});

describe("currentCampaignLevel", () => {
  it("nível ativo é o desbloqueado sem selo ainda", () => {
    expect(currentCampaignLevel(buildProgress())).toBe("beginner");
  });

  it("avança para o próximo quando o atual já tem selo", () => {
    const progress = buildProgress({
      beginner: { selo_concedido: true, vitorias: 3 },
      easy: { desbloqueado: true },
    });
    expect(currentCampaignLevel(progress)).toBe("easy");
  });

  it("retorna null quando todos os desbloqueados já foram dominados (Mestre concluído)", () => {
    const progress = buildProgress({
      beginner: { desbloqueado: true, selo_concedido: true, vitorias: 3 },
      easy: { desbloqueado: true, selo_concedido: true, vitorias: 3 },
      medium: { desbloqueado: true, selo_concedido: true, vitorias: 3 },
      hard: { desbloqueado: true, selo_concedido: true, vitorias: 3 },
      master: { desbloqueado: true, selo_concedido: true, vitorias: 3 },
    });
    expect(currentCampaignLevel(progress)).toBeNull();
  });
});

describe("resolvePreselectedLevel", () => {
  it("mantém a última config usada se ainda desbloqueada", () => {
    const progress = buildProgress({ easy: { desbloqueado: true } });
    expect(resolvePreselectedLevel("easy", progress)).toBe("easy");
  });

  it("cai para o nível desbloqueado mais alto se a config salva estiver travada", () => {
    const progress = buildProgress({ easy: { desbloqueado: true } });
    expect(resolvePreselectedLevel("medium", progress)).toBe("easy");
  });
});
