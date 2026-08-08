import { NODE_URL } from "./api";
import { authFetch } from "./session";
import type { Difficulty } from "@/constants/aiGame";

/**
 * Lance da IA, calculado pelo Stockfish no node-api.
 *
 * Autenticado: a engine é o recurso mais caro do servidor e não atende mais
 * requisição anônima. Vai por `authFetch` (e não `fetch`) porque o access
 * token vive 30 min e uma partida vs IA passa disso com facilidade — o
 * `authFetch` renova e repete a chamada de forma transparente, o que exige
 * que o node-api devolva `code: "token_not_valid"` no 401 (ele devolve).
 */
export const getBestMove = async (
  fen: string,
  difficulty: Difficulty = "medium",
  token: string
) => {
  try {
    const response = await authFetch(`${NODE_URL}/api/v1/game/move`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Envia o NÍVEL (não a profundidade): a calibragem real de força
      // (Skill Level + depth + movetime) é aplicada no node-api por nível.
      body: JSON.stringify({ fen, difficulty }),
    });

    const data = await response.json();
    return data.bestMove;
  } catch (error) {
    console.log("❌ Erro na API:", error);
    return null;
  }
};
