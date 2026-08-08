// O endpoint da engine deixou de atender requisição anônima. Estes testes
// cobrem o lado do app: mandar o token, e mandar por um caminho que sobrevive
// à expiração do access token no meio de uma partida longa.

import { getBestMove } from "../game";
import { setSessionAccessToken } from "../session";

// Storage em memória — a renovação lê o refresh token daqui (SecureStore no
// device). Mesmo padrão do session.test.ts. (`jest.mock` é içado acima dos
// imports pelo babel-jest, então a ordem aqui é só de leitura.)
jest.mock("@/utils/storage", () => {
  const store = new Map<string, string>([["refreshToken", "refresh-valido"]]);
  return {
    __store: store,
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItem: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("getBestMove", () => {
  beforeEach(() => {
    // O módulo de sessão guarda o último access token que viu; sem zerar,
    // um teste herdaria o token renovado pelo anterior.
    setSessionAccessToken(null);
  });

  afterEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockRestore?.();
    jest.restoreAllMocks();
  });

  function mockFetch(response: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(response),
    }) as unknown as typeof fetch;
  }

  it("envia o token no header Authorization", async () => {
    mockFetch({ bestMove: "e7e5" });

    const move = await getBestMove(FEN, "medium", "token-de-acesso");

    expect(move).toBe("e7e5");
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/v1/game/move");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-de-acesso"
    );
  });

  it("envia fen e nível de dificuldade no corpo", async () => {
    mockFetch({ bestMove: "d7d5" });

    await getBestMove(FEN, "beginner", "t");

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      fen: FEN,
      difficulty: "beginner",
    });
  });

  it("401 de token expirado renova a sessão e repete a chamada", async () => {
    // O caminho que justifica usar authFetch em vez de fetch: uma partida vs
    // IA passa dos 30 min de vida do access token com facilidade.
    const refreshed = { ok: true, status: 200, json: async () => ({ bestMove: "e7e5" }) };
    const expired = {
      ok: false,
      status: 401,
      clone: () => ({ json: async () => ({ code: "token_not_valid" }) }),
      json: async () => ({ code: "token_not_valid" }),
    };
    const tokenRefresh = {
      ok: true,
      status: 200,
      json: async () => ({ access: "token-novo", refresh: "refresh-novo" }),
    };

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(expired) // engine: 401
      .mockResolvedValueOnce(tokenRefresh) // /token/refresh/
      .mockResolvedValueOnce(refreshed) as unknown as typeof fetch; // engine de novo

    const move = await getBestMove(FEN, "medium", "token-velho");

    expect(move).toBe("e7e5");
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[1][0]).toContain("/token/refresh/");
    // A segunda tentativa na engine já vai com o token renovado.
    expect((calls[2][1].headers as Record<string, string>).Authorization).toBe(
      "Bearer token-novo"
    );
  });

  it("falha de rede devolve null (o chamador já trata como lance ausente)", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("Network request failed")) as unknown as typeof fetch;

    await expect(getBestMove(FEN, "medium", "t")).resolves.toBeNull();
  });
});
