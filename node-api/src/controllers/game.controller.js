const { getBestMove, LEVELS, DEFAULT_LEVEL } = require("../services/stockfish.service");

async function move(req, res, next) {
  try {
    const fen = req.body?.fen;
    const rawDifficulty = req.body?.difficulty;
    const rawDepth = req.body?.depth;

    if (!fen || typeof fen !== "string") {
      return res.status(400).json({ error: "Campo 'fen' é obrigatório e deve ser uma string." });
    }

    // Contrato novo (PR C): o app envia `difficulty` (nível de força). Mantém
    // compatibilidade com `depth` numérico (contrato antigo) e cai no nível
    // padrão se nada vier.
    let level;
    if (typeof rawDifficulty === "string" && LEVELS[rawDifficulty]) {
      level = rawDifficulty;
    } else if (typeof rawDepth === "number") {
      level = rawDepth;
    } else {
      level = DEFAULT_LEVEL;
    }

    console.log("📥 FEN recebida:", fen, "| nível:", level);

    const bestMove = await getBestMove(fen, level);

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
