import { canPlayGame } from "@/services/payments";

// Gating pré-jogo vs IA (RF-MON-05, ajuste da PR #70): a checagem acontece
// ANTES de o tabuleiro abrir, não no registro do resultado. O backend
// (AiGameResultView) mantém a mesma trava como defesa em profundidade.

export type PreGameGateResult =
  | { allowed: true }
  | { allowed: false; code: "daily_limit_reached" };

export async function checkAiGameAllowed(
  token: string | null,
  timeControl: number | null
): Promise<PreGameGateResult> {
  // Sem relógio = partida não-rateada (decisão do PR #68) — nunca gateada
  if (timeControl === null) return { allowed: true };
  if (!token) return { allowed: true };

  try {
    const gate = await canPlayGame(token);
    if (gate.can_play === false) {
      return { allowed: false, code: "daily_limit_reached" };
    }
    return { allowed: true };
  } catch {
    // Fail-open: rede/backend fora não bloqueia o jogo local — a defesa em
    // profundidade continua no backend ao registrar o resultado.
    return { allowed: true };
  }
}
