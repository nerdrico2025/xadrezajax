import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import AuthScreenLayout from "@/components/AuthScreenLayout";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import { Colors } from "@/constants/theme";

export default function Login() {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

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
    <AuthScreenLayout showLogo centered>
      <Text style={[styles.subtitle, { color: colors.text }]}>Entrar</Text>

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

      <View style={styles.errorRow}>
        {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : <View />}
        <TouchableOpacity onPress={() => router.push("/forgot-password")}>
          <Text style={[styles.forgotPassword, { color: colors.tabIconDefault }]}>
            Esqueceu a senha?
          </Text>
        </TouchableOpacity>
      </View>

      <Button title="Acessar" onPress={handleLogin} loading={loading} variant="primary" />

      <Divider text="ou" />

      <Button
        title="Entrar com Google"
        onPress={handleGoogleLogin}
        loading={googleLoading}
        variant="secondary"
        iconName="logo-google"
      />

      <TouchableOpacity onPress={() => router.push("/register")}>
        <Text style={[styles.link, { color: colors.tabIconDefault }]}>
          Ainda não tem conta? Cadastre-se
        </Text>
      </TouchableOpacity>
    </AuthScreenLayout>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "left",
    marginBottom: 10,
  },
  errorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  error: {
    flex: 1,
    marginRight: 8,
    fontWeight: "600",
  },
  forgotPassword: {
    fontWeight: "600",
    fontSize: 12,
  },
  link: {
    textAlign: "center",
    marginTop: 24,
    fontWeight: "600",
    fontSize: 14,
  },
});
