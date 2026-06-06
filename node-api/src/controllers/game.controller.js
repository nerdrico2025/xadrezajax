const { getBestMove } = require("../services/stockfish.service");

async function move(req, res, next) {
  try {
    const { fen } = req.body;

    if (!fen || typeof fen !== "string") {
      return res.status(400).json({ error: "Campo 'fen' é obrigatório e deve ser uma string." });
    }

    console.log("📥 FEN recebida:", fen);

    const bestMove = await getBestMove(fen);

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
