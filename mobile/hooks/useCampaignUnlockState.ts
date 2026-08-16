import { useMemo } from "react";

import { AI_LEVELS, type Difficulty } from "@/constants/aiGame";
import { QA_UNLOCK_ALL_AI_LEVELS } from "@/constants/qaFlags";
import { useCampaignProgress } from "@/hooks/useCampaignProgress";
import { currentCampaignLevel } from "@/utils/campaignHelpers";
import type { CampaignLevelProgress } from "@/services/campaign";

/**
 * Estado de desbloqueio da campanha, em UM lugar só.
 *
 * Existe porque DUAS telas precisam da mesma regra — o wizard vs IA (cadeado
 * no passo de nível) e o Mapa da Campanha. Antes de existir, a regra vivia
 * inline no wizard; duplicá-la no mapa garantiria que um dia elas
 * divergissem, e o cadeado é justamente o tipo de coisa que não pode
 * discordar de si mesma entre telas.
 *
 * A flag de QA (`EXPO_PUBLIC_QA_UNLOCK_LEVELS`) é respeitada AQUI, do mesmo
 * jeito que o wizard já fazia: ela destrava a seleção para testar a
 * calibragem em device sem ter de vencer a campanha antes, e não altera o
 * progresso real — `wins` e `selo_concedido` continuam vindo do servidor.
 */

export type NodeState = "done" | "current" | "locked";

export interface CampaignNode {
  id: Difficulty;
  label: string;
  elo: number;
  icon: string;
  state: NodeState;
  wins: number;
  winsToUnlock: number;
  /** True quando o cadeado só não aparece por causa da flag de QA. */
  unlockedByQaOnly: boolean;
}

export interface CampaignUnlockState {
  nodes: CampaignNode[];
  /** Nível em progresso (desbloqueado e ainda sem selo), ou null. */
  currentLevel: Difficulty | null;
  progress: CampaignLevelProgress[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Enquanto true, não dá para confiar no cadeado exibido. */
  blocking: boolean;
}

/**
 * Regra de estado de cada nó, na ordem dos 5 níveis:
 *
 *   done    → selo concedido (o nível foi dominado)
 *   current → desbloqueado e ainda sem selo
 *   locked  → não desbloqueado
 *
 * `selo_concedido` é o que separa "concluído" de "atual" — e não `wins >=
 * WINS_TO_UNLOCK`, porque o selo é a marca que o SERVIDOR carimba uma vez só
 * (ver record_campaign_win). Derivar do contador reproduziria a regra do
 * backend no cliente, e as duas poderiam discordar.
 */
export function useCampaignUnlockState(): CampaignUnlockState {
  const { progress, loading, error, refresh } = useCampaignProgress();

  const nodes = useMemo<CampaignNode[]>(() => {
    return AI_LEVELS.map((level) => {
      const row = progress?.find((p) => p.nivel === level.id);
      const desbloqueado = row?.desbloqueado ?? false;
      const concluido = row?.selo_concedido ?? false;

      let state: NodeState;
      if (concluido) state = "done";
      else if (desbloqueado) state = "current";
      else state = "locked";

      // A flag de QA destrava a NAVEGAÇÃO, não o progresso: um nó que só
      // está acessível por causa dela continua sabendo disso, para a tela
      // poder sinalizar que aquilo não é o estado real.
      const unlockedByQaOnly = QA_UNLOCK_ALL_AI_LEVELS && state === "locked";

      return {
        id: level.id,
        label: level.label,
        elo: level.elo,
        icon: level.icon,
        state: unlockedByQaOnly ? "current" : state,
        wins: row?.vitorias ?? 0,
        winsToUnlock: row?.vitorias_para_desbloquear ?? 3,
        unlockedByQaOnly,
      };
    });
  }, [progress]);

  return {
    nodes,
    currentLevel: progress ? currentCampaignLevel(progress) : null,
    progress,
    loading,
    error,
    refresh,
    // Mesmo critério do wizard: sem progresso confiável, o cadeado exibido
    // pode estar errado, então a tela segura a interação em vez de deixar o
    // usuário tocar num nó cujo estado ela não conhece.
    blocking: loading || (!!error && !progress),
  };
}

/** Quantas vitórias faltam no nível ANTERIOR para destravar este. Usado no
 *  feedback de toque em nó bloqueado — um toque morto seria pior que um "não". */
export function winsMissingFor(
  nodes: CampaignNode[],
  index: number
): { faltam: number; anterior: string } | null {
  const anterior = nodes[index - 1];
  if (!anterior) return null;
  return {
    faltam: Math.max(0, anterior.winsToUnlock - anterior.wins),
    anterior: anterior.label,
  };
}
