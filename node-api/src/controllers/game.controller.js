const { getBestMove, DEPTH_BY_DIFFICULTY } = require("../services/stockfish.service");

async function move(req, res, next) {
  try {
    const fen = req.body?.fen;
    const rawDepth = req.body?.depth;

    if (!fen || typeof fen !== "string") {
      return res.status(400).json({ error: "Campo 'fen' é obrigatório e deve ser uma string." });
    }

    const depth = typeof rawDepth === "number"
      ? rawDepth
      : DEPTH_BY_DIFFICULTY[rawDepth] ?? 8;

    console.log("📥 FEN recebida:", fen, "| depth:", depth);

    const bestMove = await getBestMove(fen, depth);

    if (!bestMove) {
      return res.status(422).json({ error: "Stockfish não retornou uma jogada válida." });
    }

    console.log("✅ Melhor jogada:", bestMove);

    return res.json({ bestMove });
  } catch (err) {
    next(err);
  }
}

module.exports = { move };
