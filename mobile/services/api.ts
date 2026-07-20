export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
export const NODE_URL = process.env.EXPO_PUBLIC_NODE_URL ?? "http://localhost:3000";
export const ENV = (process.env.EXPO_PUBLIC_ENV ?? "development") as "development" | "preview" | "production";

export const IS_DEV = ENV === "development";
export const IS_PROD = ENV === "production";

// Rótulos PT-BR para prefixar erros de validação por campo do DRF — sem o
// rótulo, mensagens como "não tenha mais de 200 caracteres" não dizem QUAL
// campo foi rejeitado.
const FIELD_LABELS: Record<string, string> = {
  full_name: "Nome",
  username: "Nome de usuário",
  bio: "Bio",
  avatar: "Foto",
  email: "E-mail",
  old_password: "Senha atual",
  new_password: "Nova senha",
  password: "Senha",
};

/**
 * Extrai a mensagem real de uma resposta de erro da API, cobrindo os três
 * formatos do DRF: {detail}, {campo: [msgs]} e {non_field_errors: [msgs]}.
 * Corpo não-JSON (HTML de 500/proxy) cai no fallback com o status — nunca
 * engolimos o erro em uma mensagem genérica sem contexto.
 */
export async function apiErrorMessage(
  res: Response,
  fallback: string
): Promise<string> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === "object") {
    if (typeof body.detail === "string") return body.detail;
    for (const [field, value] of Object.entries(body)) {
      const msg =
        typeof value === "string"
          ? value
          : Array.isArray(value) && typeof value[0] === "string"
            ? value[0]
            : null;
      if (msg) {
        if (field === "non_field_errors") return msg;
        return `${FIELD_LABELS[field] ?? field}: ${msg}`;
      }
    }
  }
  return `${fallback} (erro ${res.status})`;
}
