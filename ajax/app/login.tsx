import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useState } from "react";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useTheme } from "@/hooks/useTheme";
import AuthScreenLayout from "@/components/AuthScreenLayout";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import { Colors } from "@/constants/theme";

const API_URL = "http://192.168.0.128:8000";

export default function Login() {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    console.log("🔥 LOGIN CLICADO");

    setError("");

    if (!email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data?.detail || "Email ou senha inválidos");
        return;
      }

      // 🔐 SALVAR TOKEN
      await AsyncStorage.setItem("accessToken", data.access);
      await AsyncStorage.setItem("refreshToken", data.refresh);

      console.log("✅ LOGIN OK");

      router.replace("/home");

    } catch (err) {
      console.log("💥 ERRO:", err);
      setError("Erro de conexão com servidor");
    } finally {
      setLoading(false);
    }
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

      {error ? (
        <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
      ) : null}

      <Button title="Acessar" onPress={handleLogin} loading={loading} />

      <Divider text="ou" />

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
    marginBottom: 10,
  },
  error: {
    marginBottom: 10,
    fontWeight: "600",
  },
  link: {
    textAlign: "center",
    marginTop: 20,
    fontWeight: "600",
  },
});