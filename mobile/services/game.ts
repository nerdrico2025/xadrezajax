import { NODE_URL } from "./api";
import type { Difficulty } from "@/constants/aiGame";

export const getBestMove = async (fen: string, difficulty: Difficulty = "medium") => {
  try {
    // Envia o NÍVEL (não a profundidade): a calibragem real de força
    // (Skill Level + depth + movetime) é aplicada no node-api por nível.
    const response = await fetch(`${NODE_URL}/api/v1/game/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, difficulty }),
    });

    const data = await response.json();
    return data.bestMove;
  } catch (error) {
    console.log("❌ Erro na API:", error);
    return null;
  }
};
