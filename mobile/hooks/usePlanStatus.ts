import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { getSubscription } from "@/services/payments";

/**
 * Em que pé está a consulta do plano do usuário.
 *
 * Substitui o antigo `useHasPaidPlan(): boolean`, que colapsava QUATRO
 * situações em `false`: ainda não sei, sei que é Grátis, sei que é pago, e
 * não consegui descobrir. Quem consumia o hook não tinha como distinguir
 * "este usuário não paga" de "a rede caiu" — e escondia a seção nos dois
 * casos, que é metade do bug de tela silenciosa que isto corrige.
 */
export type PlanStatus =
  /** A resposta ainda não chegou. */
  | "loading"
  /** Plano pago confirmado (`trialing`/`active` no servidor). */
  | "paid"
  /** Confirmadamente Grátis — inclui usuário sem token. */
  | "free"
  /** A CHECAGEM falhou (rede, 500). Não diz nada sobre o plano. */
  | "error";

export function usePlanStatus(): PlanStatus {
  const { token } = useAuth();
  const [status, setStatus] = useState<PlanStatus>("loading");

  useEffect(() => {
    // Sem token não há o que consultar, e isso não é falha: é Grátis com
    // certeza, porque nem conta existe.
    if (!token) {
      setStatus("free");
      return;
    }
    let alive = true;
    setStatus("loading");
    getSubscription(token)
      .then((subscription) => {
        if (alive) setStatus(subscription.plan !== "free" ? "paid" : "free");
      })
      .catch(() => {
        // NÃO cai para "free". Tratar falha de rede como "não paga" é
        // exatamente o que fazia a análise sumir da tela de quem paga.
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return status;
}
