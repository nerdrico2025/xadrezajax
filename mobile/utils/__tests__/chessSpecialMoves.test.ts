import { Chess } from "chess.js";

import { parseUciMove, derivePromotion } from "../chessSpecialMoves";

// FEN com roque pequeno e grande disponíveis para as brancas
const BOTH_CASTLES_FEN = "r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 0 1";
// FEN onde exd6 en passant é legal (peão preto acabou de jogar d7-d5)
const EN_PASSANT_FEN = "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3";
// Peão branco em e7 pronto para promover
const PROMOTION_FEN = "7k/4P3/8/8/8/8/8/4K3 w - - 0 1";

describe("parseUciMove", () => {
  it("converte lance simples", () => {
    expect(parseUciMove("e2e4")).toEqual({ from: "e2", to: "e4", promotion: undefined });
  });

  it("converte promoção com peça escolhida", () => {
    expect(parseUciMove("e7e8q")).toEqual({ from: "e7", to: "e8", promotion: "q" });
    expect(parseUciMove("a2a1n")).toEqual({ from: "a2", to: "a1", promotion: "n" });
  });

  it("rejeita entradas inválidas", () => {
    expect(parseUciMove(null)).toBeNull();
    expect(parseUciMove("")).toBeNull();
    expect(parseUciMove("e2")).toBeNull();
  });
});

describe("derivePromotion", () => {
  it("deduz a peça promovida a partir dos FENs antes/depois", () => {
    for (const piece of ["q", "r", "b", "n"] as const) {
      const after = new Chess(PROMOTION_FEN);
      after.move({ from: "e7", to: "e8", promotion: piece });
      expect(derivePromotion(PROMOTION_FEN, after.fen(), "e7", "e8")).toBe(piece);
    }
  });

  it("retorna undefined para lance comum", () => {
    const before = new Chess();
    const after = new Chess();
    after.move({ from: "e2", to: "e4" });
    expect(derivePromotion(before.fen(), after.fen(), "e2", "e4")).toBeUndefined();
  });

  it("retorna undefined para roque (rei termina na última fileira, mas não é peão)", () => {
    const after = new Chess(BOTH_CASTLES_FEN);
    after.move({ from: "e1", to: "g1" });
    expect(derivePromotion(BOTH_CASTLES_FEN, after.fen(), "e1", "g1")).toBeUndefined();
  });
});

// Invariantes do chess.js dos quais o patch da react-native-chessboard
// depende (patches/react-native-chessboard+0.1.2.patch): as casas de
// destino vêm de moves({ square, verbose: true }).map(m => m.to).
describe("destinos legais via moves verbose (base do patch da lib)", () => {
  const destinationsOf = (fen: string, square: string) =>
    new Chess(fen).moves({ square: square as any, verbose: true }).map((m) => m.to);

  it("roque pequeno: g1 é destino do rei em e1", () => {
    expect(destinationsOf(BOTH_CASTLES_FEN, "e1")).toContain("g1");
  });

  it("roque grande: c1 é destino do rei em e1", () => {
    expect(destinationsOf(BOTH_CASTLES_FEN, "e1")).toContain("c1");
  });

  it("en passant: d6 é destino do peão em e5", () => {
    expect(destinationsOf(EN_PASSANT_FEN, "e5")).toContain("d6");
  });

  it("a notação SAN sozinha não contém a casa do roque (bug original)", () => {
    const sanMoves = new Chess(BOTH_CASTLES_FEN).moves({ square: "e1" as any });
    expect(sanMoves).toContain("O-O");
    expect(sanMoves.some((san) => san.includes("g1"))).toBe(false);
  });
});

describe("execução dos lances especiais no estado do app (chess.js 1.x)", () => {
  it("roque pequeno e grande executam com { from, to }", () => {
    const short = new Chess(BOTH_CASTLES_FEN);
    expect(short.move({ from: "e1", to: "g1" })?.san).toBe("O-O");
    const long = new Chess(BOTH_CASTLES_FEN);
    expect(long.move({ from: "e1", to: "c1" })?.san).toBe("O-O-O");
  });

  it("en passant executa e remove o peão capturado", () => {
    const game = new Chess(EN_PASSANT_FEN);
    const move = game.move({ from: "e5", to: "d6" });
    expect(move?.flags).toContain("e");
    expect(move?.captured).toBe("p");
  });

  it("subpromoção (torre, bispo, cavalo) é aceita — não só rainha", () => {
    for (const piece of ["r", "b", "n"] as const) {
      const game = new Chess(PROMOTION_FEN);
      const move = game.move({ from: "e7", to: "e8", promotion: piece });
      expect(move?.promotion).toBe(piece);
    }
  });
});
