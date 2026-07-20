import { apiErrorMessage } from "../api";

function res(status: number, body?: unknown, json = true): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: json
      ? async () => body
      : async () => {
          throw new SyntaxError("Unexpected token <");
        },
  } as unknown as Response;
}

describe("apiErrorMessage", () => {
  it("prefere o detail quando presente", async () => {
    expect(
      await apiErrorMessage(res(403, { detail: "Sem permissão." }), "Falha")
    ).toBe("Sem permissão.");
  });

  it("extrai erro de campo com rótulo PT-BR (o caso da bio que era engolido)", async () => {
    expect(
      await apiErrorMessage(
        res(400, { bio: ["Certifique-se de que este campo não tenha mais de 200 caracteres."] }),
        "Falha ao salvar o perfil"
      )
    ).toBe("Bio: Certifique-se de que este campo não tenha mais de 200 caracteres.");
  });

  it("extrai non_field_errors sem prefixo de campo", async () => {
    expect(
      await apiErrorMessage(
        res(400, { non_field_errors: ["As senhas não coincidem."] }),
        "Falha"
      )
    ).toBe("As senhas não coincidem.");
  });

  it("campo desconhecido usa o próprio nome como rótulo", async () => {
    expect(
      await apiErrorMessage(res(400, { xpto: ["Inválido."] }), "Falha")
    ).toBe("xpto: Inválido.");
  });

  it("corpo não-JSON (HTML de 500/proxy) cai no fallback com o status", async () => {
    expect(await apiErrorMessage(res(502, undefined, false), "Falha ao salvar o perfil")).toBe(
      "Falha ao salvar o perfil (erro 502)"
    );
  });
});
