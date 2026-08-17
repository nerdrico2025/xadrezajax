import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";

import { useAuth } from "@/context/AuthContext";
import { registerPushToken, type DevicePlatform } from "@/services/pushToken";

// FUNDAÇÃO de push — pré-requisito do Modo Turno (correspondência). Este
// arquivo NÃO decide QUANDO pedir permissão — quem decide é a tela que
// chama `requestAndRegister()`, no momento de contexto real (ex.: ao entrar
// no Modo Turno pela primeira vez). Não existe hoje nenhuma tela de Modo
// Turno no app, então nada aqui dispara o pedido sozinho.
//
// O que ESTE hook faz por conta própria, sem pedir nada, é registrar de novo
// quando a permissão JÁ estava concedida — isso não é fricção (não mostra
// diálogo nenhum) e é o que mantém `last_seen_at` fresco a cada abertura do
// app, para uma fase futura poder distinguir device ativo de abandonado.

export type PushPermissionStatus =
  /** Ainda não checamos. */
  | "unknown"
  /** SO nunca perguntou a este usuário (é o estado em que faz sentido pedir). */
  | "undetermined"
  | "granted"
  | "denied";

interface UsePushPermissionResult {
  status: PushPermissionStatus;
  /** True enquanto uma chamada a requestAndRegister() está em voo. */
  requesting: boolean;
  /**
   * Pede a permissão ao SO (se ainda não decidida) e, se concedida, registra
   * o token no backend. Devolve o status final.
   *
   * Idempotente: chamar de novo com a permissão já concedida não reabre
   * diálogo nenhum (o SO decide isso, não este hook) — só re-registra, o que
   * no servidor é um no-op (ver DeviceTokenView).
   */
  requestAndRegister: () => Promise<PushPermissionStatus>;
}

function toStatus(permission: Notifications.NotificationPermissionsStatus): PushPermissionStatus {
  if (permission.status === "granted") return "granted";
  if (permission.status === "undetermined") return "undetermined";
  return "denied";
}

/**
 * Pega o token Expo push do device atual e registra no backend.
 *
 * Duas guardas antes de sequer tentar:
 *   - `Device.isDevice`: simulador/emulador não tem push de verdade, e
 *     `getExpoPushTokenAsync` levanta lá. Sem isto todo teste em simulador
 *     (o fluxo mais comum de dev) logaria erro à toa.
 *   - `projectId`: `getExpoPushTokenAsync` exige — vem de app.json
 *     (extra.eas.projectId), que já existe no projeto para os builds EAS.
 *
 * Nunca levanta: falha aqui não pode derrubar a tela que chamou. O pior
 * caso é o token não ser registrado desta vez; a próxima abertura tenta de
 * novo.
 */
async function syncToken(authToken: string): Promise<void> {
  if (!Device.isDevice) return;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;

  try {
    // Canal padrão no Android: sem ele, um push que chegar (fase futura)
    // não teria prioridade/som definidos e o SO usaria um default ruim.
    // Configurar aqui, na fundação, evita que a fase de disparo precise
    // lembrar de fazer isso antes do primeiro envio.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform: DevicePlatform = Platform.OS === "ios" ? "ios" : "android";
    await registerPushToken(token, authToken, platform);
  } catch {
    // Silencioso de propósito: registro de token é bônus de infraestrutura,
    // não uma ação que o usuário pediu — não há o que mostrar a ele se
    // falhar, e a próxima sincronização tenta de novo.
  }
}

export function usePushPermission(): UsePushPermissionResult {
  const { token: authToken } = useAuth();
  const [status, setStatus] = useState<PushPermissionStatus>("unknown");
  const [requesting, setRequesting] = useState(false);
  // Evita sincronizar duas vezes na mesma montagem (StrictMode chama efeitos
  // duas vezes em dev) e re-registrar a cada re-render.
  const syncedRef = useRef(false);

  useEffect(() => {
    let vivo = true;
    Notifications.getPermissionsAsync().then((permissao) => {
      if (!vivo) return;
      const atual = toStatus(permissao);
      setStatus(atual);

      // Silencioso: já estava concedida, só mantém o token fresco. Não é
      // "pedir de novo" — nenhum diálogo aparece.
      if (atual === "granted" && authToken && !syncedRef.current) {
        syncedRef.current = true;
        syncToken(authToken);
      }
    });
    return () => {
      vivo = false;
    };
  }, [authToken]);

  const requestAndRegister = useCallback(async (): Promise<PushPermissionStatus> => {
    if (!authToken) return status;
    setRequesting(true);
    try {
      const permissao = await Notifications.requestPermissionsAsync();
      const novoStatus = toStatus(permissao);
      setStatus(novoStatus);
      if (novoStatus === "granted") {
        await syncToken(authToken);
      }
      return novoStatus;
    } finally {
      setRequesting(false);
    }
  }, [authToken, status]);

  return { status, requesting, requestAndRegister };
}
