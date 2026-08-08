const { verifyAccessToken } = require("../services/jwt");

/**
 * Handshake do WebSocket. Aceita o token no `auth` do socket.io ou no header
 * Authorization. As REGRAS do token (assinatura, expiração, tipo) vivem em
 * services/jwt.js — as mesmas dos endpoints HTTP, para as duas portas não
 * divergirem com o tempo.
 */
function verifySocketToken(socket, next) {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.replace("Bearer ", "");

  try {
    const { userId } = verifyAccessToken(token);
    socket.userId = userId;
    next();
  } catch (err) {
    next(new Error(err.message));
  }
}

module.exports = { verifySocketToken };
