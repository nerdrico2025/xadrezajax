import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import {
  NoPuzzlesAvailableError,
  TrainingRequiresPremiumError,
  difficultyForRating,
  getDailyPuzzle,
  getNextPuzzle,
  getPuzzleStats,
  type PuzzleData,
  type PuzzleMode,
  type PuzzleStats,
} from "@/services/puzzles";

/**
 * Estados possíveis da sessão. `exhausted` e `locked` são exclusivos do
 * redesenho: o diário pode esgotar as 4 tentativas, e o Treino pode estar
 * travado para quem não tem plano pago.
 */
export type PuzzleSessionState =
  | "loading"
  | "playing"
  | "solved"
  | "exhausted"
  | "locked"
  | "empty"
  | "error";

/**
 * Encapsula TODA a diferença entre "Problema do dia" e "Treino": de onde vem
 * o problema, se há dificuldade adaptativa e como o gating se manifesta.
 * A tela consome sempre a mesma interface e não sabe de endpoint.
 */
export function usePuzzleSession(mode: PuzzleMode) {
  const { token, user } = useAuth();
  const { profile, loading: profileLoading } = useProfile();

  const [state, setState] = useState<PuzzleSessionState>("loading");
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Só o diário tem contagem de tentativas — o Treino é ilimitado.
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(0);

  const refreshStats = useCallback(async () => {
    if (!token) return null;
    try {
      const data = await getPuzzleStats(token);
      setStats(data);
      return data;
    } catch {
      // O contador do cabeçalho é acessório: sem ele a sessão segue jogável.
      return null;
    }
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setState("loading");
    setError(null);
    try {
      if (mode === "daily") {
        const daily = await getDailyPuzzle(token);
        setPuzzle(daily);
        setAttemptsUsed(daily.attempts_used);
        setMaxAttempts(daily.max_attempts);
        if (daily.exhausted) setState("exhausted");
        else if (daily.already_solved) setState("solved");
        else setState("playing");
      } else {
        // Treino: dificuldade adaptativa pelo rating Glicko-2 blitz.
        const rating = profile?.ratings?.blitz?.rating ?? user?.rating ?? 1500;
        const next = await getNextPuzzle(token, difficultyForRating(rating));
        setPuzzle(next);
        setAttemptsUsed(0);
        setMaxAttempts(0);
        setState("playing");
      }
      await refreshStats();
    } catch (e: unknown) {
      if (e instanceof TrainingRequiresPremiumError) {
        setState("locked");
      } else if (e instanceof NoPuzzlesAvailableError) {
        setState("empty");
      } else {
        // Erro real fica visível com a causa (regra do PR #77).
        setError((e as Error)?.message ?? "Falha ao carregar o problema");
        setState("error");
      }
    }
  }, [token, mode, profile, user, refreshStats]);

  useEffect(() => {
    if (profileLoading) return;
    load();
    // Carrega uma vez quando o rating fica disponível — recarregar a cada
    // mudança de profile remontaria o problema em andamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, mode]);

  return {
    state,
    setState,
    puzzle,
    stats,
    error,
    attemptsUsed,
    setAttemptsUsed,
    maxAttempts,
    reload: load,
    refreshStats,
  };
}
