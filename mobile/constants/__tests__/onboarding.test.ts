import { Chess } from "chess.js";

import {
  DIFFICULTY_BY_LEVEL,
  EXPERIENCE_OPTIONS,
  FREQUENCY_OPTIONS,
  MATE_DIAGRAMS,
} from "../onboarding";

describe("diagramas da pergunta 2 (mate em 1)", () => {
  const hasMateInOne = (fen: string) =>
    new Chess(fen).moves().some((san) => san.endsWith("#"));

  it("todos os FENs são posições válidas", () => {
    for (const diagram of MATE_DIAGRAMS) {
      expect(() => new Chess(diagram.fen)).not.toThrow();
    }
  });

  it("exatamente um diagrama tem mate em 1, e é o marcado como correto", () => {
    for (const diagram of MATE_DIAGRAMS) {
      expect(hasMateInOne(diagram.fen)).toBe(diagram.isMate);
    }
    expect(MATE_DIAGRAMS.filter((d) => d.isMate)).toHaveLength(1);
  });

  it("são 3 opções, como manda o fluxo de 3 toques", () => {
    expect(MATE_DIAGRAMS).toHaveLength(3);
  });
});

describe("mapeamentos do onboarding", () => {
  it("todo nível tem uma dificuldade de IA correspondente", () => {
    expect(DIFFICULTY_BY_LEVEL).toEqual({
      beginner: "easy",
      intermediate: "medium",
      advanced: "hard",
    });
  });

  it("perguntas 1 e 3 têm 3 opções cada (1 toque cada)", () => {
    expect(EXPERIENCE_OPTIONS).toHaveLength(3);
    expect(FREQUENCY_OPTIONS).toHaveLength(3);
  });
});
