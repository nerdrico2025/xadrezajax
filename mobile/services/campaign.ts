import { API_URL, apiErrorMessage } from "./api";
import { authFetch } from "./session";
import type { Difficulty } from "@/constants/aiGame";

/** Estado de um nível do Modo Campanha vs IA — espelha o GET
 * /api/v1/auth/campaign/ do backend (nomes de campo em PT-BR, contrato
 * fechado no PR 1 do épico). */
export interface CampaignLevelProgress {
  nivel: Difficulty;
  desbloqueado: boolean;
  vitorias: number;
  vitorias_para_desbloquear: number;
  selo_concedido: boolean;
}

export async function getCampaignProgress(
  token: string
): Promise<CampaignLevelProgress[]> {
  const res = await authFetch(`${API_URL}/api/v1/auth/campaign/`, token, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      await apiErrorMessage(res, "Falha ao carregar o progresso da campanha")
    );
  }
  return res.json();
}
