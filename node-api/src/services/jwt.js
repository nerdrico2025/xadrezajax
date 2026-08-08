const jwt = require("jsonwebtoken");

// ─────────────────────────────────────────────────────────────────────────────
// Verificação do token de acesso do usuário final — FONTE ÚNICA.
//
// O token é o MESMO que o app usa para falar com o Django: o SimpleJWT assina
// com `SECRET_KEY` em HS256, e o node-api só precisa do segredo compartilhado
// para validar. Não há chamada ao Django para isso — validar uma assinatura é
// local e barato; buscar o Django a cada lance da IA colocaria o backend no
// caminho crítico do tabuleiro.
//
// Por que um módulo só: o WebSocket já validava token (socket/auth.js) e os
// endpoints HTTP não validavam nada. Com duas cópias das regras, uma delas
// envelhece — e a que envelhece vira o buraco. Regra única, um lugar só.
//
// NÃO confundir com `X-Internal-Secret`: aquele é servidor-para-servidor
// (node-api → Django) e não identifica usuário nenhum.
// ─────────────────────────────────────────────────────────────────────────────

/** Erro de autenticação com o status HTTP já decidido.
 *
 * Os 401 carregam `code: "token_not_valid"` — o MESMO código que o SimpleJWT
 * devolve no Django. Não é imitação gratuita: o app renova a sessão sozinho
 * quando vê esse código (`authFetch` em mobile/services/session.ts), e o
 * token que validamos aqui é justamente o do SimpleJWT. Sem isto, uma partida
 * vs IA que passasse dos 30 min de vida do access token começaria a falhar no
 * meio, com o app sem saber que bastava renovar. */
function authError(message, status = 401) {
  const err = new Error(message);
  err.status = status;
  if (status === 401) err.code = "token_not_valid";
  return err;
}

/**
 * Valida um access token do Django e devolve `{ userId }`.
 * Lança (com `status`) se o token faltar, estiver expirado, tiver assinatura
 * inválida ou não for do tipo "access" — um refresh token não abre portas.
 */
function verifyAccessToken(token) {
  if (!token) throw authError("Token não fornecido");

  const secret = process.env.SECRET_KEY;
  // 500 e não 401: servidor mal configurado não é culpa de quem chamou. E
  // falhar fechado é obrigatório — sem segredo, nada de "deixa passar".
  if (!secret) throw authError("SECRET_KEY não configurado", 500);

  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    throw authError("Token inválido ou expirado");
  }

  if (payload.token_type !== "access") {
    throw authError("Tipo de token inválido");
  }

  return { userId: payload.user_id };
}

/** Extrai o token de um header `Authorization: Bearer <token>`. */
function tokenFromAuthHeader(header) {
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

module.exports = { verifyAccessToken, tokenFromAuthHeader, authError };
