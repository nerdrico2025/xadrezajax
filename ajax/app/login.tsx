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
import Button from "../components/Button";
import InputLine from "../components/InputLine";
import Divider from "../components/Divider";
import { Colors } from "@/constants/theme";

const sunIcon = require("../assets/images/sun.svg");
const moonIcon = require("../assets/images/moon.svg");
const logoAjax = require("../assets/images/logo_ajax.svg");
const emailIcon = require("../assets/images/email_icon.svg");
const lockIcon = require("../assets/images/cadeado.svg");
const googleIcon = require("../assets/images/google_icon.svg");

export default function Login() {

  const { theme, toggleTheme } = useTheme();
  const colors = Colors[theme];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [error, setError] = useState("");

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      padding: 24,
      backgroundColor: colors.background,
    },
    logoContainer: {
      alignItems: "center",
      marginBottom: 5,
    },
    logo: {
      width: 280,
      height: 280,
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
    themeButton: {
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
    },
    themeIcon: {
      width: 24,
      height: 24,
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
        <View style={[styles.container, { backgroundColor: colors.background, width: "100%", maxWidth: 400, alignSelf: "center" }]}>

      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={toggleTheme}
          style={styles.themeButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Image
            source={theme === "light" ? moonIcon : sunIcon}
            style={styles.themeIcon}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </View>

      <View style={styles.logoContainer}>
        {theme === "light" && (
          <Image
            source={logoAjax}
            style={styles.logo}
            resizeMode="contain"
          />
        )}

        {theme === "dark" && (
          <Image
            source={logoAjax}
            style={[styles.logo, { tintColor: colors.primary }]}
            resizeMode="contain"
          />
        )}
      </View>
      <Text style={styles.subtitle}>Entrar</Text>

      <InputLine
        icon={emailIcon}
        placeholder="Digite seu Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />

      <InputLine
        icon={lockIcon}
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
        icon={googleIcon}
      />

      <TouchableOpacity onPress={() => router.push("/register")}>        
        <Text style={styles.link}>Ainda não tem conta? Cadastre-se</Text>
      </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
