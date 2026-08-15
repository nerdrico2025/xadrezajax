import { API_URL } from "./api";
import { authFetch } from "./session";

// CONQUISTAS — sistema IRMÃO do Modo Campanha (`services/campaign.ts`), não
// uma extensão dele. Marcos de uso do produto, sem ordem entre si; o Campanha
// continua sendo a progressão sequencial pelos 5 níveis da IA.
//
// Contrato do GET /api/v1/auth/achievements/ (nomes em pt-BR, como no
// endpoint da campanha).

export interface Achievement {
  /** Identidade ESTÁVEL — o app casa ícone e texto por aqui, nunca por nome. */
  code: string;
  nome: string;
  descricao: string;
  /** Nome de ícone do Ionicons. */
  icone: string;
  categoria: string;
  conquistada: boolean;
  conquistada_em: string | null;
  /** Conquistada mas ainda NÃO comemorada. Quem decide é o servidor, para a
   *  comemoração não repetir ao trocar de aparelho nem sumir ao reinstalar. */
  nova: boolean;
  /** Só nas regras cumulativas e enquanto não conquistada ("7/10 partidas"). */
  progresso?: { atual: number; alvo: number };
}

/** Conquista recém-desbloqueada, como vem na resposta do fim de partida. */
export interface NewAchievement {
  code: string;
  nome: string;
  descricao: string;
  icone: string;
}

export async function getAchievements(token: string): Promise<Achievement[]> {
  const res = await authFetch(`${API_URL}/api/v1/auth/achievements/`, token, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Falha ao carregar as conquistas");
  return res.json();
}

/**
 * Marca conquistas como já comemoradas. Sem `codes`, marca todas as pendentes.
 *
 * É o que impede a celebração dupla: o fim de partida comemora a partir do
 * `conquistas_novas` da resposta e chama isto em seguida; o que sobrar aparece
 * no Perfil com `nova: true` até ser visto lá.
 */
export async function markAchievementsSeen(
  token: string,
  codes?: string[]
): Promise<number> {
  const res = await authFetch(`${API_URL}/api/v1/auth/achievements/seen/`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(codes ? { codes } : {}),
  });
  if (!res.ok) throw new Error("Falha ao marcar as conquistas");
  const data = await res.json();
  return data?.marcadas ?? 0;
}
