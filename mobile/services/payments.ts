import { API_URL } from "./api";

// Assinaturas via Stripe (item 0.1). O estado do plano SEMPRE vem do
// backend (fonte de verdade) — nada de plano guardado só localmente.

export type PaidPlan = "monthly" | "annual";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export interface SubscriptionState {
  plan: PaidPlan | "free";
  status: SubscriptionStatus | null;
  current_period_end: string | null;
  trial_end: string | null;
  daily_game_limit: number | null;
  remaining_games_today: number | null;
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export async function getSubscription(
  token: string
): Promise<SubscriptionState> {
  const res = await fetch(`${API_URL}/api/v1/payments/subscription/`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error("Falha ao carregar o plano");
  return res.json();
}

export async function createCheckoutSession(
  token: string,
  plan: PaidPlan
): Promise<{ checkout_url: string }> {
  const res = await fetch(`${API_URL}/api/v1/payments/stripe/checkout/`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? "Falha ao iniciar o checkout");
  }
  return res.json();
}
