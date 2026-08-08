import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { getSubscription } from "@/services/payments";

/**
 * O usuário tem plano pago?
 *
 * Serve para o app não OFERECER o que ele não pode ter (e não pedir ao
 * servidor o que sabe que vai ser negado). Nunca é a trava: quem protege o
 * conteúdo é o backend, que responde "indisponivel" para quem não paga.
 * Aqui é só economia de chamada e de tela vazia.
 *
 * Começa `false` de propósito: enquanto o plano não é conhecido, o padrão é
 * não mostrar. Um piscar de conteúdo pago que some é pior do que ele aparecer
 * meio segundo depois.
 */
export function useHasPaidPlan(): boolean {
  const { token } = useAuth();
  const [hasPaidPlan, setHasPaidPlan] = useState(false);

  useEffect(() => {
    if (!token) {
      setHasPaidPlan(false);
      return;
    }
    let alive = true;
    getSubscription(token)
      .then((subscription) => {
        if (alive) setHasPaidPlan(subscription.plan !== "free");
      })
      // Falha ao consultar o plano não pode quebrar a tela em que o hook está
      // (hoje, a de fim de partida). Sem resposta = trata como Grátis.
      .catch(() => {
        if (alive) setHasPaidPlan(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return hasPaidPlan;
}
