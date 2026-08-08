function errorHandler(err, _req, res, _next) {
  console.error("❌ Erro não tratado:", err.message);

  const status = err.status || 500;
  const body = {
    error: status === 500 ? "Erro interno no servidor." : err.message,
  };
  // `code` só existe em erro com contrato (hoje: "token_not_valid", que o app
  // usa para renovar a sessão sozinho). Nunca vaza em 500 — mensagem de erro
  // interno não descreve o interno.
  if (err.code && status !== 500) body.code = err.code;

  res.status(status).json(body);
}

module.exports = errorHandler;
