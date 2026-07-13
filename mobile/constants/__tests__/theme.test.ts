import { Colors } from "../theme";

// Validação WCAG do Dourado AJAX (RF-VISUAL-01, critério de aceite §4):
// contraste do accent sobre os fundos dos dois temas e do accentText sobre
// o accent. Fórmula de luminância relativa do WCAG 2.1.

function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("token accent (Dourado AJAX #C9A84C)", () => {
  it("existe nos dois temas com o mesmo valor (cor de marca, não varia)", () => {
    expect(Colors.light.accent).toBe("#C9A84C");
    expect(Colors.dark.accent).toBe(Colors.light.accent);
    expect(Colors.light.accentText).toBe(Colors.dark.accentText);
  });

  it("accentText sobre accent passa WCAG AA para texto normal (≥ 4.5:1)", () => {
    expect(
      contrast(Colors.light.accentText, Colors.light.accent)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("accent sobre o fundo escuro passa WCAG AA (≥ 3:1 para componentes)", () => {
    expect(
      contrast(Colors.dark.accent, Colors.dark.background)
    ).toBeGreaterThanOrEqual(3);
  });

  it("accent sobre o fundo claro NÃO alcança 3:1 — documentado: no tema claro" +
     " o dourado é preenchimento/realce, nunca cor de texto", () => {
    const ratio = contrast(Colors.light.accent, Colors.light.background);
    expect(ratio).toBeLessThan(3); // se a marca mudar o tom, revisar o uso
    expect(ratio).toBeGreaterThan(2); // ainda serve como realce decorativo
  });
});
