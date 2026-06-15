import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useState, useEffect, useMemo } from "react";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";

import { useTheme } from "@/hooks/useTheme";
import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";
import { Images } from "@/constants/images";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import ThemeToggle from "@/components/ThemeToggle";
import { Colors } from "@/constants/theme";
import { loginUser, loginWithGoogle } from "@/app/services/api";

// Essencial para fechar a aba de auth
WebBrowser.maybeCompleteAuthSession();

export default function Login() {
  const { theme } = useTheme();
  const colors = Colors[theme];
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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [error, setError] = useState("");

  // Configuração do Google Auth
  const [, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID, // Mantemos como fallback para o Expo Go
  });

  // Fica escutando a resposta do Google após fechar o navegador
  useEffect(() => {
    if (response?.type === "success") {
      const { id_token } = response.params;
      if (id_token) {
        processGoogleAuth(id_token);
      }
    } else if (response?.type === "error") {
      setError("Erro ao se comunicar com o Google.");
      setGoogleLoading(false);
    }
  }, [response]);

  const processGoogleAuth = async (idToken: string) => {
    setGoogleLoading(true);
    setError("");
    try {
      await loginWithGoogle(idToken);
      router.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar com Google.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLogin = async () => {
    setError("");

    if (!email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Por favor, insira um e-mail válido.");
      return;
    }

    setLoading(true);

    try {
      await loginUser(email.trim().toLowerCase(), password);
      router.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao fazer login.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setError("");
    setGoogleLoading(true);
    promptAsync(); // Abre a tela nativa do Google
  };

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      padding: contentPadding,
      backgroundColor: colors.background,
    },
    logoContainer: {
      alignItems: "center",
      marginBottom: logoSpacing,
    },
    logo: {
      width: logoSize,
      height: logoSize,
    },
    subtitle: {
      fontSize: 32,
      fontWeight: "bold",
      textAlign: "left",
      marginBottom: 10,
      color: colors.background === "#0D0D0D" ? colors.tint : colors.text,
    },
    forgotPassword: {
      textAlign: "right",
      marginBottom: 12,
      color: colors.tabIconDefault,
      fontWeight: "600",
      fontSize: 12,
    },
    error: {
      color: colors.error,
      marginBottom: 10,
      textAlign: "center",
      fontWeight: "600",
    },
    link: {
      textAlign: "center",
      marginTop: 24,
      color: colors.tabIconDefault,
      fontWeight: "600",
      fontSize: 14,
    },
    topBar: {
      position: "absolute",
      top: 50,
      right: 20,
      zIndex: 10,
    },
  }), [colors, logoSize, contentPadding, logoSpacing]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.container, { backgroundColor: colors.background, width: "100%", maxWidth, alignSelf: "center" }]}>

      <View style={styles.topBar}>
        <ThemeToggle />
      </View>
      <View style={styles.logoContainer}>
        <Image
          source={Images.logoAjax}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.subtitle}>Entrar</Text>

      <InputLine
        iconName="mail-outline"
        placeholder="Digite seu Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <InputLine
        iconName="lock-closed-outline"
        placeholder="Digite sua Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {error ? <Text style={[styles.error, { textAlign: 'left', marginBottom: 12 }]}>{error}</Text> : <View />}
        <TouchableOpacity onPress={() => router.push("/forgot-password")}>
          <Text style={styles.forgotPassword}>Esqueceu a senha?</Text>
        </TouchableOpacity>
      </View>
      <Button
        title="Acessar"
        onPress={handleLogin}
        loading={loading}
        variant="primary"
      />

      <Divider text="ou" />

      <Button
        title="Entrar com Google"
        onPress={handleGoogleLogin}
        loading={googleLoading}
        variant="secondary"
        iconName="logo-google"
      />

      <TouchableOpacity onPress={() => router.push("/register")}>        
        <Text style={styles.link}>Ainda não tem conta? Cadastre-se</Text>
      </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}