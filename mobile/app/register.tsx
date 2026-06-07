import { Text, TouchableOpacity, StyleSheet } from "react-native";
import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import AuthScreenLayout from "@/components/AuthScreenLayout";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import { Colors } from "@/constants/theme";
import { API_URL } from "@/services/api";

export default function Register() {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = async () => {

    setError("");

    // 🔍 DEBUG valores
    console.log("📌 Dados:");
    console.log("Nome:", name);
    console.log("Email:", email);
    console.log("Senha:", password);
    console.log("Confirmar:", confirmPassword);

    // ✅ validações
    if (!name || !email || !password || !confirmPassword) {
      console.log("❌ Falta campo");
      setError("Preencha todos os campos");
      return;
    }

    if (password.length < 8) {
      console.log("❌ Senha curta");
      setError("Senha deve ter pelo menos 8 caracteres");
      return;
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      console.log("❌ Senha sem letra ou número");
      setError("Senha deve conter letras e números");
      return;
    }

    if (password !== confirmPassword) {
      console.log("❌ Senhas diferentes");
      setError("As senhas não coincidem");
      return;
    }

    console.log("✅ Passou validações");

    setLoading(true);

    try {
      console.log("🚀 Enviando request...");

      const response = await fetch(`${API_URL}/api/v1/auth/register/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          full_name: name,
          email: email,
          password: password,
          password_confirm: confirmPassword,
        }),
      });

      console.log("📡 STATUS:", response.status);

      const data = await response.json();

      console.log("📦 RESPONSE DATA:", data);

      if (!response.ok) {
        console.log("❌ Erro da API");

        setError(
          data?.non_field_errors?.[0] ||
          data?.email?.[0] ||
          data?.password?.[0] ||
          "Erro ao cadastrar"
        );
        return;
      }

      alert("Cadastro realizado com sucesso!");
      router.replace("/login");

    } catch (err) {
      console.log("💥 ERRO DE CONEXÃO:", err);
      setError("Erro de conexão com servidor");
    } finally {
      setLoading(false);
      console.log("🏁 FINALIZOU");
    }
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
    <AuthScreenLayout showLogo>
      <Text style={[styles.subtitle, { color: colors.text }]}>
        Novo Usuário
      </Text>

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

      <InputLine
        iconName="lock-closed-outline"
        placeholder="Confirme sua Senha"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />

      {error ? (
        <Text style={[styles.error, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}

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
        <Text style={[styles.link, { color: colors.tabIconDefault }]}>
          Já possui uma conta? Faça o login
        </Text>
      </TouchableOpacity>
    </AuthScreenLayout>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: 36,
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