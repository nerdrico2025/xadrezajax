export const Images = {
  logo: require("../assets/images/logo.png"),
  logo2: require("../assets/images/logo2.png"),
  logoAjax: require("../assets/images/logo_ajax.png"),
  logoAjaxDark: require("../assets/images/logo_ajax02.png"),
};

export type ThemeOption = "light" | "dark";

type LogoVariant = "ajax" | "splash";

/** Proporção do desenho em relação ao canvas 500×500 (normaliza tamanho visual). */
const LOGO_CONTENT_RATIO: Record<LogoVariant, { light: number; dark: number }> = {
  ajax: { light: 353 / 500, dark: 468 / 500 },
  splash: { light: 361 / 500, dark: 463 / 500 },
};

export function getLogoAjax(theme: ThemeOption) {
  return theme === "dark" ? Images.logoAjaxDark : Images.logoAjax;
}

export function getSplashLogo(theme: ThemeOption) {
  return theme === "dark" ? Images.logoAjaxDark : Images.logo2;
}

/** Tamanho de exibição para o logo parecer igual ao do tema claro. */
export function getLogoDisplaySize(
  theme: ThemeOption,
  baseSize: number,
  variant: LogoVariant = "ajax",
) {
  if (theme === "light") return baseSize;

  const { light, dark } = LOGO_CONTENT_RATIO[variant];
  return baseSize * (light / dark);
}
