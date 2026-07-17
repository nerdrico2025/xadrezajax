import { API_URL } from "./api";

export type RatingModality = "bullet" | "blitz" | "rapid";

// Rating Glicko-2 de uma modalidade. `provisional` = período de calibração
// (primeiras 20 partidas na modalidade, RD ainda alto).
export interface ModalityRating {
  rating: number;
  deviation: number;
  games_played: number;
  provisional: boolean;
}

/** Bloco de estatísticas do Perfil (decisão D2) — nunca somar os dois. */
export interface StatsBlock {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

export interface UserProfile {
  email: string;
  full_name: string;
  username: string | null;
  avatar: string | null;
  bio: string;
  /** Espelho legado do rating blitz (compatibilidade) — prefira `ratings`. */
  rating: number;
  ratings: Record<RatingModality, ModalityRating>;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  /** Partidas com relógio contra humanos — a única fonte do rating. */
  stats_ranked: StatsBlock;
  /** Partidas contra a IA e sem relógio — não alteram o rating. */
  stats_casual: StatsBlock;
  date_joined: string;
  friends_count: number;
}

export interface UpdateProfileData {
  full_name?: string;
  username?: string;
  bio?: string;
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export async function getProfile(token: string): Promise<UserProfile> {
  const res = await fetch(`${API_URL}/api/v1/auth/profile/`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error("Falha ao carregar perfil");
  return res.json();
}

export async function updateProfile(
  token: string,
  data: UpdateProfileData
): Promise<UserProfile> {
  const res = await fetch(`${API_URL}/api/v1/auth/profile/`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail ?? body?.username?.[0] ?? body?.full_name?.[0] ?? `Erro ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}

export async function uploadAvatar(
  token: string,
  uri: string
): Promise<UserProfile> {
  const filename = uri.split("/").pop() ?? "avatar.jpg";
  const ext = filename.split(".").pop() ?? "jpg";
  const formData = new FormData();
  formData.append("avatar", { uri, name: filename, type: `image/${ext}` } as any);

  const res = await fetch(`${API_URL}/api/v1/auth/profile/`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) throw new Error("Falha ao enviar avatar");
  return res.json();
}

export type HistoryFilter = "all" | "ranked" | "ai";

export interface GameHistoryEntry {
  id: number;
  opponent_name: string;
  result: "win" | "loss" | "draw";
  mode: "ai" | "online";
  modality: RatingModality;
  /** False = partida vs IA ou sem relógio (não alterou o rating). */
  rated: boolean;
  rating_before: number;
  rating_after: number;
  rating_delta: number;
  played_at: string;
}

export async function getGameHistory(
  token: string,
  limit = 20,
  offset = 0,
  filter: HistoryFilter = "all"
): Promise<GameHistoryEntry[]> {
  const res = await fetch(
    `${API_URL}/api/v1/auth/game/history/?limit=${limit}&offset=${offset}&filter=${filter}`,
    { headers: headers(token) }
  );
  if (!res.ok) throw new Error("Falha ao carregar histórico");
  return res.json();
}

export async function reportAiResult(
  token: string,
  result: "win" | "loss" | "draw",
  difficulty: "easy" | "medium" | "hard",
  // Segundos do relógio da partida (null = sem limite) — define a modalidade
  // Glicko-2 no backend (bullet < 3 min, blitz 3–10 min, rápido > 10/sem limite)
  timeControl: number | null = null
): Promise<{ rating: number; provisional: boolean; modality: RatingModality }> {
  const res = await fetch(`${API_URL}/api/v1/auth/game/ai-result/`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ result, difficulty, time_control: timeControl }),
  });
  if (!res.ok) throw new Error("Falha ao salvar resultado");
  return res.json();
}

export interface LeaderboardEntry {
  rank: number;
  user_id: number;
  username: string;
  full_name: string;
  rating: number;
  provisional: boolean;
  modality: RatingModality;
  games_played: number;
  wins: number;
}

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API_URL}/api/v1/auth/leaderboard/?limit=${limit}`);
  if (!res.ok) throw new Error("Falha ao carregar leaderboard");
  return res.json();
}

export async function changePassword(
  token: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/auth/password/change/`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ?? "Falha ao trocar senha");
}

export async function deleteAccount(token: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/auth/account/`, {
    method: "DELETE",
    headers: headers(token),
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Falha ao excluir conta");
  }
}

export function avatarUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${API_URL}${path}`;
}
