import { View, Image, type ImageStyle, type StyleProp } from "react-native";

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
  style?: StyleProp<ImageStyle>;
}

export default function AppLogo({
  theme,
  size,
  variant = "ajax",
  style,
}: AppLogoProps) {
  const source = variant === "splash" ? getSplashLogo(theme) : getLogoAjax(theme);
  const dimension = getLogoDisplaySize(theme, size, variant);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Image
        source={source}
        style={[{ width: dimension, height: dimension }, style]}
        resizeMode="contain"
      />
    </View>
  );
}
