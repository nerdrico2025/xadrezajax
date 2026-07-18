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

// Compõe o accentMuted (rgba 12%) sobre um fundo sólido, como o RN renderiza.
function compositeMuted(bgHex: string): string {
  const alpha = 0.12;
  const accent = "C9A84C";
  const bg = bgHex.replace("#", "");
  const mix = [0, 2, 4].map((i) => {
    const fv = parseInt(accent.slice(i, i + 2), 16);
    const bv = parseInt(bg.slice(i, i + 2), 16);
    return Math.round(alpha * fv + (1 - alpha) * bv);
  });
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
}

describe("tokens derivados do dourado (PR F): accentMuted / accentPressed / accentOnLight", () => {
  it("existem nos dois temas", () => {
    for (const theme of [Colors.light, Colors.dark]) {
      expect(theme.accentMuted).toBe("rgba(201, 168, 76, 0.12)");
      expect(theme.accentPressed).toBe("#B39440");
      expect(theme.accentOnLight).toBeDefined();
    }
  });

  it("accentText sobre accentPressed passa AA para texto (≥ 4.5:1)", () => {
    expect(
      contrast(Colors.light.accentText, Colors.light.accentPressed)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("tema claro: accentOnLight passa AA como texto sobre background, card e accentMuted composto", () => {
    const { accentOnLight, background, card } = Colors.light;
    expect(contrast(accentOnLight, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accentOnLight, card)).toBeGreaterThanOrEqual(4.5);
    // pior caso: chip com fundo accentMuted sobre o background da tela
    expect(
      contrast(accentOnLight, compositeMuted(background))
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accentOnLight, compositeMuted(card))).toBeGreaterThanOrEqual(4.5);
  });

  it("tema escuro: accentOnLight = accent e passa AA sobre background, card e accentMuted composto", () => {
    const { accentOnLight, accent, background, card } = Colors.dark;
    expect(accentOnLight).toBe(accent);
    expect(contrast(accentOnLight, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accentOnLight, card)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(accentOnLight, compositeMuted(background))
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accentOnLight, compositeMuted(card))).toBeGreaterThanOrEqual(4.5);
  });

  it("warning não é laranja em nenhum tema (D4): matiz amarelo, ≥ 45°", () => {
    const hue = (hex: string): number => {
      const c = hex.replace("#", "");
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d === 0) return 0;
      const h =
        max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const theme of [Colors.light, Colors.dark]) {
      expect(hue(theme.warning)).toBeGreaterThanOrEqual(45);
    }
  });
});
