const { spawn } = require("child_process");

const MOVE_TIME_MS = parseInt(process.env.STOCKFISH_MOVE_TIME || "1000", 10);

function getBestMove(fen) {
  return new Promise((resolve, reject) => {
    const engine = spawn("stockfish");

    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        engine.kill();
        reject(new Error("Stockfish timeout"));
      }
    }, MOVE_TIME_MS + 3000);

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
    engine.stdin.write(`go movetime ${MOVE_TIME_MS}\n`);
  });
}

module.exports = { getBestMove };
