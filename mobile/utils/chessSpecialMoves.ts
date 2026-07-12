import { Chess } from "chess.js";

export type PromotionPiece = "q" | "r" | "b" | "n";

const PROMOTION_PIECES: readonly string[] = ["q", "r", "b", "n"];

/**
 * Converte um lance UCI ("e2e4", "e7e8q") em { from, to, promotion? }.
 * Retorna null se a string não tiver o formato mínimo esperado.
 */
export function parseUciMove(
  uci: string | null | undefined
): { from: string; to: string; promotion?: PromotionPiece } | null {
  if (!uci || uci.length < 4) return null;
  const from = uci.substring(0, 2);
  const to = uci.substring(2, 4);
  const promoChar = uci.substring(4, 5).toLowerCase();
  const promotion = PROMOTION_PIECES.includes(promoChar)
    ? (promoChar as PromotionPiece)
    : undefined;
  return { from, to, promotion };
}

/**
 * Deduz a peça de promoção de um lance do oponente a partir dos FENs
 * antes/depois — o servidor só envia { from, to } no broadcast.
 * Retorna undefined quando o lance não é promoção.
 */
export function derivePromotion(
  prevFen: string,
  newFen: string,
  from: string,
  to: string
): PromotionPiece | undefined {
  try {
    const lastRank = to[1];
    if (lastRank !== "1" && lastRank !== "8") return undefined;

    const movedPiece = new Chess(prevFen).get(from as any);
    if (!movedPiece || movedPiece.type !== "p") return undefined;

    const landed = new Chess(newFen).get(to as any);
    if (!landed || !PROMOTION_PIECES.includes(landed.type)) return undefined;
    return landed.type as PromotionPiece;
  } catch {
    return undefined;
  }
}
