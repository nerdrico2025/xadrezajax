import { AI_LEVELS, type Difficulty } from "@/constants/aiGame";
import type { CampaignLevelProgress } from "@/services/campaign";

/** Nível desbloqueado mais alto (o desbloqueio é sempre sequencial, então o
 * último item desbloqueado na ordem dos 5 níveis é o topo atual). */
export function highestUnlockedLevel(
  progress: CampaignLevelProgress[]
): Difficulty {
  const unlocked = progress.filter((p) => p.desbloqueado);
  return unlocked.length > 0
    ? unlocked[unlocked.length - 1].nivel
    : AI_LEVELS[0].id;
}

/** Nível "em progresso": desbloqueado mas ainda não dominado (sem selo). É
 * onde a barra "N/3 vitórias" aparece no wizard. Retorna null quando todos
 * os níveis desbloqueados já foram dominados (ex.: Mestre concluído). */
export function currentCampaignLevel(
  progress: CampaignLevelProgress[]
): Difficulty | null {
  const active = progress.find((p) => p.desbloqueado && !p.selo_concedido);
  return active ? active.nivel : null;
}

/** Nível pré-selecionado ao abrir o wizard: a última config usada (PR C), se
 * ainda desbloqueada; senão, o nível desbloqueado mais alto. */
export function resolvePreselectedLevel(
  saved: Difficulty,
  progress: CampaignLevelProgress[]
): Difficulty {
  const savedRow = progress.find((p) => p.nivel === saved);
  if (savedRow?.desbloqueado) return saved;
  return highestUnlockedLevel(progress);
}
