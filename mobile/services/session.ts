import { API_URL } from "./api";
import { getItem, setItem } from "@/utils/storage";

// Renovação automática de sessão (SimpleJWT): o access token expira em 30 min
// e o backend rotaciona o refresh a cada renovação (ROTATE_REFRESH_TOKENS).
// Todo request autenticado passa por authFetch(): num 401 de token expirado o
// módulo renova via /token/refresh/ e retenta o request original uma vez.
// Requests concorrentes compartilham a MESMA renovação (single-flight) — nunca
// disparamos N refreshes em paralelo, o que invalidaria os rotacionados.
//
// O refresh token vive apenas no storage seguro do device (SecureStore) e
// trafega só no corpo do POST de renovação — nunca em URL, nunca em log.

const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";

/** Erro terminal: o refresh token também expirou/é inválido. Quem trata é o
 *  listener global (logout limpo); telas usam isSessionExpired() para não
 *  duplicar o alerta. */
export class SessionExpiredError extends Error {
  code = "session_expired" as const;
  constructor() {
    super("Sua sessão expirou. Entre novamente.");
  }
}

export function isSessionExpired(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "session_expired";
}

type SessionListener = {
  /** Access token renovado — o AuthContext atualiza o estado React. */
  onAccessTokenRefreshed?: (access: string) => void;
  /** Refresh falhou em definitivo — o AuthContext desloga e avisa o usuário. */
  onSessionExpired?: () => void;
};

let listener: SessionListener = {};
// Access token mais recente que o módulo conhece. Após um refresh, os
// próximos requests usam este valor mesmo que a tela ainda segure (via
// useAuth) o token da renderização anterior.
let latestAccess: string | null = null;
let refreshing: Promise<string> | null = null;

export function setSessionListener(next: SessionListener): void {
  listener = next;
}

/** Mantido em sincronia pelo AuthContext (boot, signIn e signOut). */
export function setSessionAccessToken(access: string | null): void {
  latestAccess = access;
}

async function requestNewAccessToken(): Promise<string> {
  const refresh = await getItem(REFRESH_TOKEN_KEY);
  if (!refresh) {
    listener.onSessionExpired?.();
    throw new SessionExpiredError();
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
  } catch {
    // Queda de rede no meio da renovação não significa sessão expirada —
    // não desloga; o caller mostra erro de conexão e o usuário retenta.
    throw new Error("Sem conexão ao renovar a sessão. Tente novamente.");
  }

  if (!res.ok) {
    // Refresh expirado/na blacklist: fim de linha da sessão. Disparado uma
    // única vez por renovação (single-flight), mesmo com N requests na fila.
    listener.onSessionExpired?.();
    throw new SessionExpiredError();
  }

  const data = await res.json();
  await setItem(ACCESS_TOKEN_KEY, data.access);
  if (data.refresh) {
    // Rotação: o refresh antigo entra na blacklist; guardar o novo é obrigatório.
    await setItem(REFRESH_TOKEN_KEY, data.refresh);
  }
  latestAccess = data.access;
  listener.onAccessTokenRefreshed?.(data.access);
  return data.access;
}

function refreshAccessToken(): Promise<string> {
  if (!refreshing) {
    refreshing = requestNewAccessToken().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** 401 de access expirado tem code "token_not_valid" (SimpleJWT); outros 401
 *  (ex.: credenciais erradas) passam direto para o caller. */
async function isTokenNotValid(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const probe = typeof res.clone === "function" ? res.clone() : res;
  const body = await probe.json().catch(() => null);
  return body?.code === "token_not_valid";
}

/**
 * fetch autenticado com renovação transparente. `token` é o access token que
 * a tela conhece (via useAuth) — usado só como fallback quando o módulo ainda
 * não viu um mais novo.
 */
export async function authFetch(
  url: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  const doFetch = (access: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${access}` },
    });

  const res = await doFetch(latestAccess ?? token);
  if (!(await isTokenNotValid(res))) return res;

  const newAccess = await refreshAccessToken();
  return doFetch(newAccess);
}
