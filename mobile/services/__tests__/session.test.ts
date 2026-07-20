import {
  authFetch,
  SessionExpiredError,
  isSessionExpired,
  setSessionAccessToken,
  setSessionListener,
} from "../session";

jest.mock("@/utils/storage", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const storage = jest.requireMock("@/utils/storage") as {
  __store: Map<string, string>;
};

const API = "http://localhost:8000/api/v1/auth/profile/";
const REFRESH_URL = "/api/v1/auth/token/refresh/";

function jsonRes(status: number, body: unknown): Response {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return res;
    },
  };
  return res as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("authFetch (renovação automática de sessão)", () => {
  beforeEach(() => {
    storage.__store.clear();
    setSessionAccessToken(null);
    setSessionListener({});
  });

  afterEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockRestore?.();
  });

  it("anexa o Authorization e devolve a resposta quando não há 401", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonRes(200, { ok: true })) as unknown as typeof fetch;

    const res = await authFetch(API, "tok1");

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok1");
  });

  it("401 token_not_valid → renova, persiste tokens rotacionados e retenta", async () => {
    storage.__store.set("refreshToken", "refresh-antigo");
    const onRefreshed = jest.fn();
    setSessionListener({ onAccessTokenRefreshed: onRefreshed });

    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (url.includes(REFRESH_URL)) {
        expect(JSON.parse(String(init?.body))).toEqual({ refresh: "refresh-antigo" });
        return Promise.resolve(
          jsonRes(200, { access: "access-novo", refresh: "refresh-novo" })
        );
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (auth === "Bearer access-novo") {
        return Promise.resolve(jsonRes(200, { salvo: true }));
      }
      return Promise.resolve(jsonRes(401, { code: "token_not_valid" }));
    }) as unknown as typeof fetch;

    const res = await authFetch(API, "access-expirado");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ salvo: true });
    // Rotação persistida: access E refresh novos no storage seguro.
    expect(storage.__store.get("accessToken")).toBe("access-novo");
    expect(storage.__store.get("refreshToken")).toBe("refresh-novo");
    expect(onRefreshed).toHaveBeenCalledWith("access-novo");
    // 3 chamadas: original, refresh, retry.
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("requests concorrentes compartilham UM refresh (single-flight)", async () => {
    storage.__store.set("refreshToken", "refresh-antigo");
    const refreshDeferred = deferred<Response>();
    let refreshCalls = 0;

    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (url.includes(REFRESH_URL)) {
        refreshCalls += 1;
        return refreshDeferred.promise;
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (auth === "Bearer access-novo") {
        return Promise.resolve(jsonRes(200, { ok: true }));
      }
      return Promise.resolve(jsonRes(401, { code: "token_not_valid" }));
    }) as unknown as typeof fetch;

    const p1 = authFetch(API, "expirado");
    const p2 = authFetch(API, "expirado");
    await flush(); // os dois já enfileirados aguardando o mesmo refresh
    refreshDeferred.resolve(jsonRes(200, { access: "access-novo" }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(refreshCalls).toBe(1);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it("401 sem code token_not_valid passa direto, sem tentar refresh", async () => {
    storage.__store.set("refreshToken", "refresh-valido");
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonRes(401, { detail: "Senha incorreta." })
      ) as unknown as typeof fetch;

    const res = await authFetch(API, "tok1");

    expect(res.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // O corpo continua legível pelo caller (probe usa clone).
    await expect(res.json()).resolves.toEqual({ detail: "Senha incorreta." });
  });

  it("refresh também expirado → SessionExpiredError e logout disparado UMA vez", async () => {
    storage.__store.set("refreshToken", "refresh-expirado");
    const onExpired = jest.fn();
    setSessionListener({ onSessionExpired: onExpired });
    const refreshDeferred = deferred<Response>();

    global.fetch = jest.fn((url: string) => {
      if (url.includes(REFRESH_URL)) return refreshDeferred.promise;
      return Promise.resolve(jsonRes(401, { code: "token_not_valid" }));
    }) as unknown as typeof fetch;

    const p1 = authFetch(API, "expirado");
    const p2 = authFetch(API, "expirado");
    // Evita unhandled rejection enquanto o refresh não resolve.
    const settled = Promise.allSettled([p1, p2]);
    await flush();
    refreshDeferred.resolve(jsonRes(401, { code: "token_not_valid" }));

    const results = await settled;
    for (const r of results) {
      expect(r.status).toBe("rejected");
      const err = (r as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(SessionExpiredError);
      expect(isSessionExpired(err)).toBe(true);
      expect(err.message).toBe("Sua sessão expirou. Entre novamente.");
    }
    // Mesmo com 2 requests na fila, o logout limpo dispara uma única vez.
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("sem refresh token no storage → SessionExpiredError direto", async () => {
    const onExpired = jest.fn();
    setSessionListener({ onSessionExpired: onExpired });
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonRes(401, { code: "token_not_valid" })
      ) as unknown as typeof fetch;

    await expect(authFetch(API, "expirado")).rejects.toBeInstanceOf(
      SessionExpiredError
    );
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("queda de rede durante o refresh NÃO desloga (não é sessão expirada)", async () => {
    storage.__store.set("refreshToken", "refresh-valido");
    const onExpired = jest.fn();
    setSessionListener({ onSessionExpired: onExpired });

    global.fetch = jest.fn((url: string) => {
      if (url.includes(REFRESH_URL)) {
        return Promise.reject(new TypeError("Network request failed"));
      }
      return Promise.resolve(jsonRes(401, { code: "token_not_valid" }));
    }) as unknown as typeof fetch;

    await expect(authFetch(API, "expirado")).rejects.toThrow(
      "Sem conexão ao renovar a sessão. Tente novamente."
    );
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("usa o access mais novo conhecido pelo módulo, não o token da tela", async () => {
    setSessionAccessToken("access-recem-renovado");
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonRes(200, { ok: true })) as unknown as typeof fetch;

    await authFetch(API, "access-velho-da-tela");

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer access-recem-renovado");
  });
});
