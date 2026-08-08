const express = require("express");
const cors = require("cors");
const errorHandler = require("./middleware/errorHandler");
const v1Routes = require("./routes/v1");
const { poolStats } = require("./services/stockfish.service");

const app = express();

app.use(cors());
app.use(express.json());

// `engine` expõe o estado do pool de Stockfish. Público de propósito: não
// revela dado de usuário e é o que permite ver contenção de fora, sem shell
// no container. Ler `waiting`/`queued` > 0 é a diferença entre saber e supor
// que a lentidão de lance vem da engine (ver enginePool.js).
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "node-api", engine: poolStats() });
});

app.use("/api/v1", v1Routes);

app.use(errorHandler);

module.exports = app;
