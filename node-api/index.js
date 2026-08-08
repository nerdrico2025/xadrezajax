const http = require("http");
const app = require("./src/app");
const { setupSocket } = require("./src/socket");
const { shutdownPool } = require("./src/services/stockfish.service");
const { shutdownAnalysisPool } = require("./src/services/analysis.service");
const {
  startAnalysisWorker,
  stopAnalysisWorker,
} = require("./src/services/analysisQueue");

const PORT = process.env.NODE_PORT || 3000;

const server = http.createServer(app);

setupSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 Node API rodando em http://0.0.0.0:${PORT}`);
  console.log(`🎮 WebSocket pronto`);
});

// Worker da análise pós-jogo. Desligado por padrão — só sobe com
// POST_GAME_ANALYSIS_ENABLED=true, e a flag do Django precisa estar ligada
// junto (senão a fila nunca tem trabalho).
startAnalysisWorker();

// Os engines do pool são processos filhos de vida longa: sem isto eles
// sobreviveriam ao redeploy como órfãos. `node` é PID 1 no container, então
// o SIGTERM do Docker chega aqui direto.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`↩️  ${signal} recebido — encerrando engines e servidor`);
    stopAnalysisWorker();
    shutdownPool();
    shutdownAnalysisPool();
    server.close(() => process.exit(0));
  });
}
