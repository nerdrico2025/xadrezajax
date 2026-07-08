import { NODE_URL } from "./api";
import type { Difficulty } from "@/components/DifficultyModal";

const DEPTH: Record<Difficulty, number> = {
  easy: 2,
  medium: 8,
  hard: 18,
};

export const getBestMove = async (fen: string, difficulty: Difficulty = "medium") => {
  try {
    const response = await fetch(`${NODE_URL}/api/v1/game/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, depth: DEPTH[difficulty] }),
    });

    const data = await response.json();
    return data.bestMove;
  } catch (error) {
    console.log("❌ Erro na API:", error);
    return null;
  }
};
