export type ScreenSize = "small" | "medium" | "large" | "tablet";

export const MAX_CONTENT_WIDTH = 400;

export function getScreenSize(width: number): ScreenSize {
  if (width < 360) {
    return "small";
  }

  if (width < 400) {
    return "medium";
  }

  if (width < 600) {
    return "large";
  }

  return "tablet";
}

export function responsiveValue<T>(size: ScreenSize, values: {
  small?: T;
  medium?: T;
  large?: T;
  tablet?: T;
}): T {
  if (size === "small") {
    return values.small ?? values.medium ?? values.large ?? values.tablet!;
  }

  if (size === "medium") {
    return values.medium ?? values.large ?? values.small ?? values.tablet!;
  }

  if (size === "large") {
    return values.large ?? values.medium ?? values.small ?? values.tablet!;
  }

  return values.tablet ?? values.large ?? values.medium ?? values.small!;
}
