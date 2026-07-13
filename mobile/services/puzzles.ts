import { API_URL } from "./api";

export type PuzzleDifficulty = "easy" | "medium" | "hard";

export interface PuzzleData {
  id: number;
  title: string;
  description: string;
  fen: string;
  /** Solução em UCI ("e2e4"); lances pares são do jogador, ímpares do oponente. */
  solution: string[];
  difficulty: PuzzleDifficulty;
  category: string;
  rating: number;
  already_solved: boolean;
}

export interface PuzzleStats {
  solved: number;
  total: number;
  attempts: number;
  /** Dias consecutivos com pelo menos um puzzle resolvido. */
  streak: number;
  /** null = plano pago (ilimitado). */
  daily_puzzle_limit: number | null;
  remaining_puzzles_today: number | null;
}

/** 403 do gating de 3 puzzles/dia do plano Grátis (RF-MON-05, item 0.2). */
export class DailyPuzzleLimitError extends Error {
  code = "daily_limit_reached" as const;
  constructor() {
    super("Limite diário de puzzles do plano Grátis atingido");
  }
}

// Dificuldade adaptativa (item 0.2): rating Glicko-2 blitz → dificuldade
// do próximo puzzle. Thresholds documentados no PLANO_FASE0 §2.
export function difficultyForRating(rating: number): PuzzleDifficulty {
  if (rating < 1000) return "easy";
  if (rating <= 1400) return "medium";
  return "hard";
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export async function getPuzzleStats(token: string): Promise<PuzzleStats> {
  const res = await fetch(`${API_URL}/api/v1/puzzles/stats/`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error("Falha ao carregar estatísticas de puzzles");
  return res.json();
}

export async function getNextPuzzle(
  token: string,
  difficulty: PuzzleDifficulty
): Promise<PuzzleData> {
  const res = await fetch(
    `${API_URL}/api/v1/puzzles/next/?difficulty=${difficulty}`,
    { headers: headers(token) }
  );
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if (body?.code === "daily_limit_reached") throw new DailyPuzzleLimitError();
  }
  if (!res.ok) throw new Error("Falha ao carregar o próximo puzzle");
  return res.json();
}

export async function reportPuzzleProgress(
  token: string,
  puzzleId: number,
  solved: boolean,
  attempts: number
): Promise<{ puzzle_id: number; solved: boolean; attempts: number }> {
  const res = await fetch(`${API_URL}/api/v1/puzzles/${puzzleId}/progress/`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ solved, attempts }),
  });
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if (body?.code === "daily_limit_reached") throw new DailyPuzzleLimitError();
  }
  if (!res.ok) throw new Error("Falha ao registrar progresso do puzzle");
  return res.json();
}
