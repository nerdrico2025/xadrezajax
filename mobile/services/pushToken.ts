import { API_URL } from "./api";
import { authFetch } from "./session";

// FUNDAÇÃO de push — pré-requisito do Modo Turno. Só o registro do token;
// nenhuma feature dispara notificação real ainda.

export type DevicePlatform = "ios" | "android";

/**
 * Registra (ou reassocia) o token Expo push do device atual.
 *
 * IDEMPOTENTE no servidor: chamar de novo com o MESMO token só atualiza
 * `last_seen_at` — é o que `useRegisterPushToken` faz a cada abertura do
 * app com permissão já concedida, sem custo.
 */
export async function registerPushToken(
  token: string,
  authToken: string,
  platform: DevicePlatform
): Promise<void> {
  const res = await authFetch(`${API_URL}/api/v1/auth/device-token/`, authToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform }),
  });
  if (!res.ok) throw new Error("Falha ao registrar o token de notificação");
}
