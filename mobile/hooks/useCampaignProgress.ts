import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { getCampaignProgress, type CampaignLevelProgress } from "@/services/campaign";

export function useCampaignProgress() {
  const { token } = useAuth();
  const [progress, setProgress] = useState<CampaignLevelProgress[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getCampaignProgress(token);
      setProgress(data);
    } catch (e: any) {
      // Preserva a causa real — regra do PR #77, não engolir erro.
      setError(e?.message ?? "Falha ao carregar o progresso da campanha");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { progress, loading, error, refresh: fetch };
}
