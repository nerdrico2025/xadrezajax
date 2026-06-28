import { View } from "react-native";
import { Image } from "expo-image";

import {
  getLogoAjax,
  getSplashLogo,
  getLogoDisplaySize,
  type ThemeOption,
} from "@/constants/images";

interface AppLogoProps {
  theme: ThemeOption;
  size: number;
  variant?: "ajax" | "splash";
}

export default function AppLogo({
  theme,
  size,
  variant = "ajax",
}: AppLogoProps) {
  const source = variant === "splash" ? getSplashLogo(theme) : getLogoAjax(theme);
  const dimension = getLogoDisplaySize(theme, size, variant);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Image
        source={source}
        style={{ width: dimension, height: dimension }}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    </View>
  );
}
