import { useEffect } from "react";
import { router } from "expo-router";

// Destino do deep link ajax://subscription-return (retorno do Stripe
// Checkout). Normalmente o navegador de checkout é interceptado pelo
// openAuthSessionAsync e esta rota nem monta; ela existe como fallback
// para o caso de o link abrir o app "do zero".
export default function SubscriptionReturn() {
  useEffect(() => {
    router.replace("/home");
  }, []);
  return null;
}
