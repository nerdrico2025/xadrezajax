import { NODE_URL } from "./api";

export const getBestMove = async (fen: string) => {
  try {
    console.log("📡 Enviando FEN:", fen);

    const response = await fetch(`${NODE_URL}/api/v1/game/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fen }),
    });

    const data = await response.json();

    console.log("✅ Resposta backend:", data);

    return data.bestMove;
  } catch (error) {
    console.log("❌ Erro na API:", error);
    return null;
  }
};