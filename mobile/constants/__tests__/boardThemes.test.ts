import {
  AJAX_GOLD,
  BOARD_THEMES,
  BOARD_THEME_ORDER,
  DEFAULT_BOARD_THEME_ID,
  NEW_USER_BOARD_THEME_ID,
  isBoardThemeId,
  toChessboardColors,
} from "../boardThemes";

// ── helpers de cor (mesma fórmula WCAG usada em theme.test.ts) ──
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
function hsl(hex: string): { h: number; s: number; l: number } {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}
// Laranja vivo proibido (logo antigo). Tons de madeira (marrom escuro) NÃO são
// laranja: exigimos matiz laranja + saturação alta + claridade alta.
function isBrightOrange(hex: string): boolean {
  const { h, s, l } = hsl(hex);
  return h >= 18 && h <= 45 && s > 0.5 && l > 0.5;
}

const ALL = BOARD_THEME_ORDER.map((id) => BOARD_THEMES[id]);

describe("temas de tabuleiro", () => {
  it("expõe exatamente 5 temas na ordem de exibição", () => {
    expect(BOARD_THEME_ORDER).toHaveLength(5);
    expect(new Set(BOARD_THEME_ORDER).size).toBe(5);
    expect(Object.keys(BOARD_THEMES)).toHaveLength(5);
  });

  it("assinatura da marca: destaque de casa selecionada e de último lance são o Dourado AJAX em TODOS os temas", () => {
    for (const t of ALL) {
      // rgba do #C9A84C = (201, 168, 76)
      expect(t.selectedHighlight).toMatch(/rgba\(\s*201\s*,\s*168\s*,\s*76/);
      expect(t.lastMoveHighlight).toMatch(/rgba\(\s*201\s*,\s*168\s*,\s*76/);
    }
    expect(AJAX_GOLD).toBe("#C9A84C");
  });

  it("nenhuma casa (clara/escura) usa laranja vivo (proibido)", () => {
    for (const t of ALL) {
      expect(isBrightOrange(t.lightSquare)).toBe(false);
      expect(isBrightOrange(t.darkSquare)).toBe(false);
    }
  });

  it("cada tema tem casas clara/escura visivelmente distintas (contraste ≥ 1.5)", () => {
    for (const t of ALL) {
      expect(contrast(t.lightSquare, t.darkSquare)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("Verde Clássico reproduz o tabuleiro atual (não muda o board de quem já joga)", () => {
    // Defaults da lib react-native-chessboard antes desta feature.
    expect(BOARD_THEMES.verde.lightSquare).toBe("#D9FDF8");
    expect(BOARD_THEMES.verde.darkSquare).toBe("#62B1A8");
  });

  it("Preto & Marfim: casa escura elevada de #0D0D0D → #262626 para legibilidade da peça preta", () => {
    // Decisão documentada no PR: a peça preta (corpo carvão + outline ~#1A1A1A)
    // perde definição em #0D0D0D; #262626 mantém a peça distinguível.
    expect(BOARD_THEMES.preto.darkSquare).toBe("#262626");
    // A casa escolhida separa a peça preta (outline ~#1A1A1A) melhor do que a
    // casa da marca #0D0D0D separaria — que é o motivo do ajuste.
    expect(contrast(BOARD_THEMES.preto.darkSquare, "#1A1A1A")).toBeGreaterThan(
      contrast("#0D0D0D", "#1A1A1A"),
    );
    // E segue sendo um tema de alto contraste entre as casas.
    expect(
      contrast(BOARD_THEMES.preto.lightSquare, BOARD_THEMES.preto.darkSquare),
    ).toBeGreaterThan(10);
  });

  it("defaults: existente → Verde Clássico, novo → Madeira AJAX", () => {
    expect(DEFAULT_BOARD_THEME_ID).toBe("verde");
    expect(NEW_USER_BOARD_THEME_ID).toBe("madeira");
  });

  it("isBoardThemeId valida ids conhecidos e rejeita lixo", () => {
    expect(isBoardThemeId("madeira")).toBe(true);
    expect(isBoardThemeId("verde")).toBe(true);
    expect(isBoardThemeId("neon")).toBe(false);
    expect(isBoardThemeId(null)).toBe(false);
    expect(isBoardThemeId(42)).toBe(false);
  });

  it("toChessboardColors mapeia casa clara→white, escura→black e inclui o destaque de seleção", () => {
    const c = toChessboardColors(BOARD_THEMES.madeira);
    expect(c.white).toBe(BOARD_THEMES.madeira.lightSquare);
    expect(c.black).toBe(BOARD_THEMES.madeira.darkSquare);
    expect(c.lastMoveHighlight).toBe(BOARD_THEMES.madeira.lastMoveHighlight);
    expect(c.checkmateHighlight).toBe(BOARD_THEMES.madeira.checkHighlight);
    expect(c.selectedSquareHighlight).toBe(BOARD_THEMES.madeira.selectedHighlight);
  });
});
