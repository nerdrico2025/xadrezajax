import { formatDeadline } from "../correspondenceTime";

const NOW = new Date("2026-08-20T12:00:00.000Z");

describe("formatDeadline", () => {
  it("sem deadline devolve string vazia (desafio pendente, sem prazo ainda)", () => {
    expect(formatDeadline(null, NOW)).toBe("");
  });

  it("prazo vencido", () => {
    expect(formatDeadline("2026-08-20T11:00:00.000Z", NOW)).toBe("prazo vencido");
  });

  it("dias e horas", () => {
    expect(formatDeadline("2026-08-22T16:00:00.000Z", NOW)).toBe("expira em 2d 4h");
  });

  it("só horas e minutos, sem dias", () => {
    expect(formatDeadline("2026-08-20T15:30:00.000Z", NOW)).toBe("expira em 3h 30min");
  });

  it("só minutos, sem horas nem dias", () => {
    expect(formatDeadline("2026-08-20T12:20:00.000Z", NOW)).toBe("expira em 20min");
  });
});
