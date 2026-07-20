import { View, Text, Pressable, StyleSheet, Animated, Easing } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
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
  // Biometria falhou/foi cancelada com sessão válida: barra só esta
  // tentativa (oferece retry), nunca desloga — a sessão salva é a
  // autenticação real, biometria é conveniência.
  const [biometricBlocked, setBiometricBlocked] = useState(false);

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

  // Tem sessão ativa — verifica biometria (sem depender do hook async). Só
  // decide entre ir para /home ou barrar esta tentativa (retry) — NUNCA
  // desloga por causa da biometria: só o token virando null (refresh
  // expirado, ver services/session.ts) manda para /login.
  const runBiometricGate = useCallback(async () => {
    const enabled = await getItem("biometricEnabled");
    if (enabled !== "true") {
      router.replace("/home");
      return;
    }

    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!compatible || !enrolled) {
      // Hardware indisponível/sem biometria cadastrada agora (device
      // mudou, usuário desativou no sistema, etc.): a sessão salva já é a
      // autenticação real — não prender quem tem sessão válida fora do
      // app por causa de uma camada de conveniência.
      router.replace("/home");
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirme sua identidade para entrar",
      cancelLabel: "Cancelar",
      fallbackLabel: "Usar senha",
    });

    if (result.success) {
      router.replace("/home");
    } else {
      setBiometricBlocked(true);
    }
  }, [router]);

  // Efeito 2: navega/verifica biometria quando animação E leitura do token terminarem
  useEffect(() => {
    if (!animDone || loading) return;

    if (!token) {
      router.replace("/login");
      return;
    }

    runBiometricGate();
  }, [animDone, loading, token, runBiometricGate]);

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
      {biometricBlocked && (
        <View style={styles.retryContainer}>
          <Text style={[styles.retryText, { color: colors.text }]}>
            Não foi possível confirmar sua identidade
          </Text>
          <Pressable
            onPress={() => {
              setBiometricBlocked(false);
              runBiometricGate();
            }}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
          >
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}
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
  retryContainer: {
    position: "absolute",
    bottom: 64,
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  retryText: {
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
