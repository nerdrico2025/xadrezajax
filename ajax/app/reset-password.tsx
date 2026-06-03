import { Text, StyleSheet } from "react-native";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import AuthScreenLayout from "@/components/AuthScreenLayout";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import { Colors } from "@/constants/theme";

export default function ResetPassword() {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleReset = () => {
    setError("");

    if (!password || !confirmPassword) {
      setError("Preencha todos os campos");
      return;
    }

    if (password !== confirmPassword) {
      setError("Senhas não coincidem");
      return;
    }

    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      alert("Senha redefinida com sucesso!");
      router.replace("/home");
    }, 1500);
  };

  return (
    <AuthScreenLayout>
      <Text style={[styles.title, { color: colors.text }]}>Nova Senha</Text>

      <InputLine
        iconName="lock-closed-outline"
        placeholder="Nova senha"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <InputLine
        iconName="lock-closed-outline"
        placeholder="Confirmar senha"
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />

      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

      <Button title="Salvar" onPress={handleReset} loading={loading} variant="primary" />
    </AuthScreenLayout>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 24,
  },
  error: {
    textAlign: "center",
    marginBottom: 10,
  },
});
