import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { listCorrespondenceGames, type CorrespondenceGame } from "@/services/correspondence";

/** Limite do plano Grátis — espelha `FREE_CORRESPONDENCE_LIMIT` do backend
 *  (`apps/payments/access.py`). Fixo aqui porque o app não tem como saber o
 *  plano do usuário sem uma mudança de backend (fora de escopo desta fase);
 *  ver decisão registrada no PR — usuário pago com 2+ partidas ativas
 *  também veria o aviso, tradeoff aceito por simplicidade. */
export const FREE_CORRESPONDENCE_LIMIT = 2;

export function useCorrespondenceGames() {
  const { token } = useAuth();
  const [games, setGames] = useState<CorrespondenceGame[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listCorrespondenceGames(token);
      setGames(data);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao carregar as partidas");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const activeCount = games?.filter((g) => g.status === "active").length ?? 0;
  const atLimit = activeCount >= FREE_CORRESPONDENCE_LIMIT;

  return { games, loading, error, refresh: fetch, activeCount, atLimit };
}
