import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { getScreenSize, MAX_CONTENT_WIDTH, ScreenSize } from "@/utils/responsive";

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const screenSize = getScreenSize(width);
  const maxWidth = Math.min(width, MAX_CONTENT_WIDTH);
  const isPortrait = height >= width;

  return useMemo(
    () => ({
      width,
      height,
      screenSize,
      maxWidth,
      isPortrait,
      isSmall: screenSize === "small",
      isMedium: screenSize === "medium",
      isLarge: screenSize === "large",
      isTablet: screenSize === "tablet",
    }),
    [width, height, screenSize, maxWidth, isPortrait],
  );
}
