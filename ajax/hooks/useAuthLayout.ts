import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";

export const AUTH_TOP_BAR_HEIGHT = 48;

export function useAuthLayout() {
  const { screenSize, maxWidth } = useResponsive();

  const logoSize = responsiveValue(screenSize, {
    small: 220,
    medium: 250,
    large: 280,
    tablet: 320,
  });

  const contentPadding = responsiveValue(screenSize, {
    small: 18,
    medium: 22,
    large: 24,
    tablet: 28,
  });

  const logoSpacing = responsiveValue(screenSize, {
    small: 10,
    medium: 12,
    large: 14,
    tablet: 16,
  });

  return {
    maxWidth,
    logoSize,
    contentPadding,
    logoSpacing,
    topBarHeight: AUTH_TOP_BAR_HEIGHT,
  };
}
