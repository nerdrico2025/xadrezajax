const { verifyAccessToken, tokenFromAuthHeader } = require("../services/jwt");

/**
 * Exige um access token válido do usuário final.
 *
 * `POST /api/v1/game/move` ficou aberto desde sempre: qualquer um com a URL
 * consumia o pool de Stockfish direto, sem custo nem identidade. Isso é o
 * recurso mais caro do serviço (um processo de engine por busca, com fila e
 * teto), e o caminho mais barato para degradar a partida de todo mundo.
 *
 * Mesmo token e mesmas regras do WebSocket (ver services/jwt.js). O `userId`
 * fica em `req.userId` para quem precisar depois.
 */
function requireAuth(req, _res, next) {
  try {
    const { userId } = verifyAccessToken(
      tokenFromAuthHeader(req.headers?.authorization)
    );
    req.userId = userId;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
