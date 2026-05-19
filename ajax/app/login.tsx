import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";
import { Images } from "@/constants/images";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import ThemeToggle from "@/components/ThemeToggle";
import { Colors } from "@/constants/theme";


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

  const styles = StyleSheet.create({
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
    fakeUser: {
      color: colors.secondary,
      textAlign: "center",
      marginTop: 40,
      fontSize: 12,
    },
    topBar: {
      position: "absolute",
      top: 50,
      right: 20,
      zIndex: 10,
    },
  });

  const handleLogin = () => {

    setError("");

    if (!email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    setLoading(true);

    setTimeout(() => {

      const fakeEmail = "admin@ajax.com";
      const fakePassword = "123456";

      if (email === fakeEmail && password === fakePassword) {

        setLoading(false);
        router.replace("/home");

      } else {

        setLoading(false);
        setError("Email ou senha inválidos");
      }

    }, 2000);
  };

  const handleGoogleLogin = () => {

    setError("");
    setGoogleLoading(true);

    setTimeout(() => {
      setGoogleLoading(false);
      router.replace("/home");
    }, 2000);
  };

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
