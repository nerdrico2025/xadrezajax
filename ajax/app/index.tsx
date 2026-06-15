import { View, StyleSheet, Animated, Easing } from "react-native";
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";
import { Images } from "@/constants/images";
import { Colors } from "@/constants/theme";
import { getRefreshToken } from "@/app/services/api";

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

    const checkAuth = async () => {
      // Garante um tempo mínimo de exibição da Splash Screen
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const token = await getRefreshToken();
      if (token) {
        router.replace("/home");
      } else {
        router.replace("/login");
      }
    };

    checkAuth();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.Image
        source={Images.logo2}
        style={[
          styles.logo,
          {
            width: logoSize,
            height: logoSize,
            opacity,
            transform: [{ scale }],
          },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    width: 200,
    height: 200,
  },
});