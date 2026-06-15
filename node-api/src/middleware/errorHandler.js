function errorHandler(err, _req, res, _next) {
  console.error("❌ Erro não tratado:", err.message);

  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? "Erro interno no servidor." : err.message,
  });
}

module.exports = errorHandler;
