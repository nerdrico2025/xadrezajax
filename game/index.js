const express = require("express");
const { spawn } = require("child_process");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/move", (req, res) => {
  const { fen } = req.body;

  console.log("📥 FEN recebida:", fen);

  const engine = spawn("stockfish");

  engine.stdout.on("data", (data) => {
    const text = data.toString();

    console.log("🤖 STOCKFISH:", text);

    const lines = text.split("\n");

    for (let line of lines) {
      if (line.startsWith("bestmove")) {
        const bestMove = line.split(" ")[1];

        console.log("✅ Melhor jogada:", bestMove);

        res.json({ bestMove });

        engine.kill();
        return;
      }
    }
  });

  engine.stdin.write("uci\n");
  engine.stdin.write("isready\n");
  engine.stdin.write(`position fen ${fen}\n`);

  // 🔥 AQUI A CORREÇÃO
  engine.stdin.write("go movetime 1000\n");
});

app.listen(3000, "0.0.0.0", () => {
  console.log("🔥 Game server rodando em http://localhost:3000");
});