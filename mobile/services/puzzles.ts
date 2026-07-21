import { API_URL, apiErrorMessage } from "./api";
import { authFetch } from "./session";

// Redesenho de 2026-07-21 — dois produtos distintos:
//   - Problema do dia: 1/dia, o MESMO para todos, grátis, 4 tentativas;
//   - Treino: problemas além do diário, exclusivo do plano pago, ilimitado.
// O modelo antigo de "3 problemas/dia no Grátis" deixou de existir.

export type PuzzleDifficulty = "easy" | "medium" | "hard";

/** Modo da sessão de problemas. Identificador técnico — não é texto de UI. */
export type PuzzleMode = "daily" | "training";

export interface PuzzleData {
  id: number;
  title: string;
  description: string;
  fen: string;
  /** Solução em UCI ("e2e4"); lances pares são do jogador, ímpares do oponente.
   *  Ausente quando o diário já está esgotado — o servidor não entrega a
   *  resposta a quem gastou as tentativas. */
  solution?: string[];
  difficulty: PuzzleDifficulty;
  category: string;
  rating: number;
  already_solved: boolean;
}

/** Problema do dia + o estado do usuário nele. */
export interface DailyPuzzleData extends PuzzleData {
  exhausted: boolean;
  attempts_used: number;
  attempts_left: number;
  max_attempts: number;
}

export interface PuzzleStats {
  solved: number;
  total: number;
  attempts: number;
  /** Dias consecutivos com pelo menos um problema resolvido. */
  streak: number;
  /** Problema do dia ainda jogável hoje (nem resolvido, nem esgotado). */
  daily_available: boolean;
  daily_solved: boolean;
  daily_exhausted: boolean;
  daily_max_attempts: number;
  /** Treino liberado — true só para plano pago. */
  training_unlocked: boolean;
}

/** Resultado do registro de progresso. Os campos de tentativa só vêm no
 *  modo diário (o Treino é ilimitado por problema). */
export interface PuzzleProgressResult {
  puzzle_id: number;
  solved: boolean;
  attempts: number;
  mode: PuzzleMode;
  attempts_used?: number;
  attempts_left?: number;
  max_attempts?: number;
  exhausted?: boolean;
}

/** 403 do gating do Treino: o problema pedido não é o do dia e o usuário não
 *  tem plano pago. */
export class TrainingRequiresPremiumError extends Error {
  code = "training_requires_premium" as const;
  constructor() {
    super("O Treino é exclusivo do plano Premium.");
  }
}

/**
 * 404 do backend quando não há nenhum problema disponível (banco não semeado).
 * Distingue "acabou o conteúdo" de "erro de rede" para a tela mostrar um
 * estado vazio decente em vez do erro genérico com retry.
 */
export class NoPuzzlesAvailableError extends Error {
  code = "no_puzzles" as const;
  constructor() {
    super("Nenhum problema disponível");
  }
}

// Dificuldade adaptativa: rating Glicko-2 blitz → dificuldade do próximo
// problema. Vale só no TREINO — o problema do dia é o mesmo para todos e por
// definição não varia por rating.
export function difficultyForRating(rating: number): PuzzleDifficulty {
  if (rating < 1000) return "easy";
  if (rating <= 1400) return "medium";
  return "hard";
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function throwForStatus(res: Response, fallback: string): Promise<never> {
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if (body?.code === "training_requires_premium") {
      throw new TrainingRequiresPremiumError();
    }
  }
  if (res.status === 404) throw new NoPuzzlesAvailableError();
  throw new Error(await apiErrorMessage(res, fallback));
}

export async function getPuzzleStats(token: string): Promise<PuzzleStats> {
  const res = await authFetch(`${API_URL}/api/v1/puzzles/stats/`, token, {
    headers: JSON_HEADERS,
  });
  if (!res.ok) {
    throw new Error(
      await apiErrorMessage(res, "Falha ao carregar estatísticas de problemas")
    );
  }
  return res.json();
}

/** Problema do dia — grátis para todos, nunca retorna 403 de plano. */
export async function getDailyPuzzle(token: string): Promise<DailyPuzzleData> {
  const res = await authFetch(`${API_URL}/api/v1/puzzles/daily/`, token, {
    headers: JSON_HEADERS,
  });
  if (!res.ok) {
    return throwForStatus(res, "Falha ao carregar o problema do dia");
  }
  return res.json();
}

/** Próximo problema do Treino — 403 para quem não tem plano pago. */
export async function getNextPuzzle(
  token: string,
  difficulty: PuzzleDifficulty
): Promise<PuzzleData> {
  const res = await authFetch(
    `${API_URL}/api/v1/puzzles/next/?difficulty=${difficulty}`,
    token,
    { headers: JSON_HEADERS }
  );
  if (!res.ok) {
    return throwForStatus(res, "Falha ao carregar o próximo problema");
  }
  return res.json();
}

export async function reportPuzzleProgress(
  token: string,
  puzzleId: number,
  solved: boolean,
  attempts: number
): Promise<PuzzleProgressResult> {
  const res = await authFetch(
    `${API_URL}/api/v1/puzzles/${puzzleId}/progress/`,
    token,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ solved, attempts }),
    }
  );
  if (!res.ok) {
    return throwForStatus(res, "Falha ao registrar progresso do problema");
  }
  return res.json();
}
