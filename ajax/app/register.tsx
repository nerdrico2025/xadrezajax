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
import { Colors } from "@/constants/theme";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import ThemeToggle from "@/components/ThemeToggle";
import { loginUser, registerUser, loginWithGoogle } from "@/app/services/api";

// Essencial para o Google fechar a janela do navegador no celular e voltar pro app
WebBrowser.maybeCompleteAuthSession();

export default function Register() {
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

  const [name, setName] = useState("");
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
      setError(err instanceof Error ? err.message : "Falha ao cadastrar com Google.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleRegister = async () => {
    setError("");

    if (!name || !email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Por favor, insira um e-mail válido.");
      return;
    }

    if (password.length < 8) {
      setError("Senha deve ter pelo menos 8 caracteres");
      return;
    }

    setLoading(true);

    try {
      await registerUser({
        email: email.trim().toLowerCase(),
        full_name: name.trim(),
        password,
      });

      try {
        await loginUser(email.trim().toLowerCase(), password);
        router.replace("/home");
      } catch (loginErr) {
        setError("Conta criada! Por favor, faça o login manualmente.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cadastrar o usuário.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRegister = () => {
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
    error: {
      color: colors.error,
      marginBottom: 10,
      textAlign: "left",
      fontWeight: "600",
    },
    link: {
      textAlign: "center",
      marginTop: 18,
      color: colors.tabIconDefault,
      fontWeight: "600",
      fontSize: 14,
    },
    topBar: {
      width: "100%",
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
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
      <Text style={styles.subtitle}>Novo Usuário</Text>

      <InputLine
        iconName="person-outline"
        placeholder="Digite seu Nome"
        value={name}
        onChangeText={setName}
      />

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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Cadastrar"
        onPress={handleRegister}
        loading={loading}
        variant="primary"
      />

      <Divider text="ou" />

      <Button
        title="Cadastrar com Google"
        onPress={handleGoogleRegister}
        loading={googleLoading}
        variant="secondary"
        iconName="logo-google"
      />

      <TouchableOpacity onPress={() => router.push("/login")}>        
        <Text style={styles.link}>Já possui uma conta? Faça o login</Text>
      </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}