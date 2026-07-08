const { spawn } = require("child_process");

const DEPTH_BY_DIFFICULTY = { easy: 2, medium: 8, hard: 18 };
const TIMEOUT_BY_DEPTH = { 2: 5000, 8: 10000, 18: 20000 };

function getBestMove(fen, depth = 8) {
  const safeDepth = Math.max(1, Math.min(depth, 20));
  const timeoutMs = TIMEOUT_BY_DEPTH[safeDepth] ?? 15000;

  return new Promise((resolve, reject) => {
    const engine = spawn("stockfish");

    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        engine.kill();
        reject(new Error("Stockfish timeout"));
      }
    }, timeoutMs);

    engine.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");

      for (const line of lines) {
        if (line.startsWith("bestmove") && !responded) {
          responded = true;
          clearTimeout(timeout);

          const bestMove = line.split(" ")[1];
          engine.kill();
          resolve(bestMove || null);
          return;
        }
      }
    });

    engine.stderr.on("data", (data) => {
      console.error("Stockfish stderr:", data.toString());
    });

    engine.on("error", (err) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        reject(new Error(`Falha ao iniciar Stockfish: ${err.message}`));
      }
    });

    engine.stdin.write("uci\n");
    engine.stdin.write("isready\n");
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(`go depth ${safeDepth}\n`);
  });
}

module.exports = { getBestMove, DEPTH_BY_DIFFICULTY };
