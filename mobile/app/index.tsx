import { View, StyleSheet, Animated, Easing } from "react-native";
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";
import { getSplashLogo, getLogoDisplaySize } from "@/constants/images";
import { Colors } from "@/constants/theme";

export default function Splash() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { screenSize } = useResponsive();

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  const logoSize = responsiveValue(screenSize, {
    small: 140,
    medium: 160,
    large: 180,
    tablet: 220,
  });

  const logoDisplaySize = getLogoDisplaySize(theme, logoSize, "splash");

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    const timer = setTimeout(() => {
      router.replace("/login");
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.logoSlot, { width: logoSize, height: logoSize }]}>
        <Animated.Image
          source={getSplashLogo(theme)}
          style={[
            {
              width: logoDisplaySize,
              height: logoDisplaySize,
              opacity,
              transform: [{ scale }],
            },
          ]}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  logoSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
});
