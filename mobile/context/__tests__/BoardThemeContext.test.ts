import { resolveBoardTheme } from "../BoardThemeContext";

// Regra de produto: nunca trocar o tabuleiro de quem já joga.
describe("resolveBoardTheme", () => {
  it("preferência salva válida sempre vence e não reescreve", () => {
    expect(resolveBoardTheme("petroleo", false, { onboarding_completed: false })).toEqual({
      themeId: "petroleo",
      persist: false,
    });
  });

  it("preferência inválida é ignorada e cai no default", () => {
    expect(resolveBoardTheme("neon", false, null)).toEqual({
      themeId: "verde",
      persist: false,
    });
  });

  it("aguarda auth (loading) antes de decidir o default", () => {
    expect(resolveBoardTheme(null, true, null)).toBeNull();
  });

  it("sem sessão: usa Verde Clássico em memória, sem persistir", () => {
    expect(resolveBoardTheme(null, false, null)).toEqual({
      themeId: "verde",
      persist: false,
    });
  });

  it("usuário NOVO (onboarding_completed === false) → Madeira AJAX, persistido", () => {
    expect(resolveBoardTheme(null, false, { onboarding_completed: false })).toEqual({
      themeId: "madeira",
      persist: true,
    });
  });

  it("usuário EXISTENTE (onboarding_completed === true) → Verde Clássico, persistido", () => {
    expect(resolveBoardTheme(null, false, { onboarding_completed: true })).toEqual({
      themeId: "verde",
      persist: true,
    });
  });

  it("usuário grandfathered (onboarding_completed undefined) → Verde Clássico (não muda o board)", () => {
    expect(resolveBoardTheme(null, false, {})).toEqual({
      themeId: "verde",
      persist: true,
    });
  });
});
