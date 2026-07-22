const http = require("http");
const app = require("./src/app");
const { setupSocket } = require("./src/socket");
const { shutdownPool } = require("./src/services/stockfish.service");

const PORT = process.env.NODE_PORT || 3000;

const server = http.createServer(app);

setupSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 Node API rodando em http://0.0.0.0:${PORT}`);
  console.log(`🎮 WebSocket pronto`);
});

// Os engines do pool são processos filhos de vida longa: sem isto eles
// sobreviveriam ao redeploy como órfãos. `node` é PID 1 no container, então
// o SIGTERM do Docker chega aqui direto.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`↩️  ${signal} recebido — encerrando engines e servidor`);
    shutdownPool();
    server.close(() => process.exit(0));
  });
}
