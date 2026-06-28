const jwt = require("jsonwebtoken");

function verifySocketToken(socket, next) {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.replace("Bearer ", "");

  if (!token) {
    return next(new Error("Token não fornecido"));
  }

  try {
    const secret = process.env.SECRET_KEY;
    if (!secret) throw new Error("SECRET_KEY não configurado");

    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });

    if (payload.token_type !== "access") {
      return next(new Error("Tipo de token inválido"));
    }

    socket.userId = payload.user_id;
    next();
  } catch (err) {
    next(new Error("Token inválido ou expirado"));
  }
}

module.exports = { verifySocketToken };
