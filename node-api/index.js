const http = require("http");
const app = require("./src/app");
const { setupSocket } = require("./src/socket");

const PORT = process.env.NODE_PORT || 3000;

const server = http.createServer(app);

setupSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 Node API rodando em http://0.0.0.0:${PORT}`);
  console.log(`🎮 WebSocket pronto`);
});
