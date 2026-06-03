import { Text, TouchableOpacity, StyleSheet } from "react-native";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import AuthScreenLayout from "@/components/AuthScreenLayout";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import { Colors } from "@/constants/theme";

export default function Register() {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = () => {
    setError("");

    if (!name || !email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    if (password.length < 6) {
      setError("Senha deve ter pelo menos 6 caracteres");
      return;
    }

    setLoading(true);

    setTimeout(() => {
      if (email === "admin@ajax.com") {
        setLoading(false);
        setError("Email já cadastrado");
        return;
      }

      setLoading(false);
      router.replace("/home");
    }, 2000);
  };

  const handleGoogleRegister = () => {
    setError("");
    setGoogleLoading(true);

    setTimeout(() => {
      setGoogleLoading(false);
      router.replace("/home");
    }, 2000);
  };

  return (
    <AuthScreenLayout showLogo centered>
      <Text style={[styles.subtitle, { color: colors.text }]}>Novo Usuário</Text>

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
      />

      <InputLine
        iconName="lock-closed-outline"
        placeholder="Digite sua Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

      <Button title="Cadastrar" onPress={handleRegister} loading={loading} variant="primary" />

      <Divider text="ou" />

      <Button
        title="Cadastrar com Google"
        onPress={handleGoogleRegister}
        loading={googleLoading}
        variant="secondary"
        iconName="logo-google"
      />

      <TouchableOpacity onPress={() => router.push("/login")}>
        <Text style={[styles.link, { color: colors.tabIconDefault }]}>
          Já possui uma conta? Faça o login
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
  error: {
    marginBottom: 10,
    fontWeight: "600",
  },
  link: {
    textAlign: "center",
    marginTop: 18,
    fontWeight: "600",
    fontSize: 14,
  },
});
