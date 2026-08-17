import { registerPushToken } from "../pushToken";

describe("registerPushToken", () => {
  afterEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockRestore?.();
  });

  it("registra com sucesso", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

    await expect(
      registerPushToken("ExponentPushToken[abc]", "auth-token", "ios")
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/device-token/"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "ExponentPushToken[abc]", platform: "ios" }),
      })
    );
  });

  it("erro do servidor vira exceção", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;

    await expect(
      registerPushToken("tok", "auth-token", "android")
    ).rejects.toThrow("Falha ao registrar o token de notificação");
  });
});
