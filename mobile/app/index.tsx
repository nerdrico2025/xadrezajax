import { View, StyleSheet, Animated, Easing } from "react-native";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";

import { useAuth } from "@/context/AuthContext";
import { getItem } from "@/utils/storage";

import { useTheme } from "@/hooks/useTheme";
import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";
import { getSplashLogo, getLogoDisplaySize } from "@/constants/images";
import { Colors } from "@/constants/theme";

export default function Splash() {
  const router = useRouter();
  const { token, loading } = useAuth();
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { screenSize } = useResponsive();
  const [animDone, setAnimDone] = useState(false);

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  const logoSize = responsiveValue(screenSize, {
    small: 140,
    medium: 160,
    large: 180,
    tablet: 220,
  });

  const logoDisplaySize = getLogoDisplaySize(theme, logoSize, "splash");

  // Efeito 1: animação + timer (roda uma vez, sem depender do auth)
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

    const timer = setTimeout(() => setAnimDone(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Efeito 2: navega quando animação E leitura do token terminarem
  useEffect(() => {
    if (!animDone || loading) return;

    if (!token) {
      router.replace("/login");
      return;
    }

    // Tem sessão ativa — verifica biometria diretamente (sem depender do hook async)
    (async () => {
      const enabled = await getItem("biometricEnabled");
      if (enabled !== "true") {
        router.replace("/home");
        return;
      }

      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!compatible || !enrolled) {
        router.replace("/home");
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirme sua identidade para entrar",
        cancelLabel: "Cancelar",
        fallbackLabel: "Usar senha",
      });

      router.replace(result.success ? "/home" : "/login");
    })();
  }, [animDone, loading, token]);

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
