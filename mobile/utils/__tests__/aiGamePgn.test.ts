// ⚠️ TEMPORÁRIO — testes da instrumentação de diagnóstico da calibragem.
// TODO(remover): junto com utils/aiGamePgn.ts.

import { buildAiGamePgn, shouldRecordPgn } from "../aiGamePgn";

describe("shouldRecordPgn — escopo da instrumentação", () => {
  it("registra APENAS os níveis sob investigação", () => {
    expect(shouldRecordPgn("beginner")).toBe(true);
    expect(shouldRecordPgn("easy")).toBe(true);
  });

  it("não registra nada nos demais níveis", () => {
    // A instrumentação não pode virar coleta silenciosa em toda partida.
    expect(shouldRecordPgn("medium")).toBe(false);
    expect(shouldRecordPgn("hard")).toBe(false);
    expect(shouldRecordPgn("master")).toBe(false);
  });
});

describe("buildAiGamePgn — PGN analisável por engine", () => {
  const base = {
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
    difficulty: "beginner" as const,
    playerColor: "w" as const,
    result: { outcome: "loss" as const, reason: "checkmate" as const },
    date: new Date(2026, 6, 22),
  };

  it("numera os lances em pares e fecha com o resultado", () => {
    const pgn = buildAiGamePgn(base);
    expect(pgn).toContain("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6");
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn.trimEnd().endsWith("0-1")).toBe(true);
  });

  it("marca quem é humano e quem é IA conforme a cor do jogador", () => {
    const brancas = buildAiGamePgn(base);
    expect(brancas).toContain('[White "Humano"]');
    expect(brancas).toContain('[Black "IA (beginner)"]');

    const pretas = buildAiGamePgn({ ...base, playerColor: "b" });
    expect(pretas).toContain('[White "IA (beginner)"]');
    expect(pretas).toContain('[Black "Humano"]');
  });

  it("traduz o resultado para a perspectiva das brancas", () => {
    // Derrota do jogador de pretas = vitória das brancas.
    expect(
      buildAiGamePgn({ ...base, playerColor: "b" })
    ).toContain('[Result "1-0"]');
    expect(
      buildAiGamePgn({ ...base, result: { outcome: "draw", reason: "stalemate" } })
    ).toContain('[Result "1/2-1/2"]');
  });

  it("registra data, nível e motivo do fim — contexto da análise", () => {
    const pgn = buildAiGamePgn(base);
    expect(pgn).toContain('[Date "2026.07.22"]');
    expect(pgn).toContain('[Difficulty "beginner"]');
    expect(pgn).toContain('[Termination "checkmate"]');
  });

  it("avisa quando a partida foi retomada de um save", () => {
    // Sem esta tag a análise leria uma partida truncada como se fosse inteira.
    const pgn = buildAiGamePgn({ ...base, resumed: true });
    expect(pgn).toContain("[Incomplete");
  });

  it("lida com número ímpar de lances (último sem resposta)", () => {
    const pgn = buildAiGamePgn({ ...base, moves: ["e4", "e5", "Nf3"] });
    expect(pgn).toContain("1. e4 e5 2. Nf3");
  });

  it("não quebra com partida sem lances (abandono imediato)", () => {
    const pgn = buildAiGamePgn({ ...base, moves: [] });
    expect(pgn).toContain('[Result "0-1"]');
  });
});
