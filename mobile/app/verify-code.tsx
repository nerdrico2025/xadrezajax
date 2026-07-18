import { Text, TouchableOpacity, StyleSheet } from "react-native";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import AuthScreenLayout from "@/components/AuthScreenLayout";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import { Colors } from "@/constants/theme";

export default function VerifyCode() {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleVerify = () => {
    setError("");

    if (!code) {
      setError("Digite o código");
      return;
    }

    setLoading(true);

    setTimeout(() => {
      const fakeCode = "123456";

      if (code === fakeCode) {
        setLoading(false);
        router.push("/reset-password");
      } else {
        setLoading(false);
        setError("Código inválido");
      }
    }, 1500);
  };

  return (
    <AuthScreenLayout>
      <Text style={[styles.title, { color: colors.text }]}>Verificação</Text>

      <Text style={[styles.subtitle, { color: colors.tint }]}>
        Digite o código enviado para seu email
      </Text>

      <InputLine
        placeholder="123456"
        keyboardType="numeric"
        value={code}
        onChangeText={setCode}
        maxLength={6}
      />

      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

      <Button title="Validar código" onPress={handleVerify} loading={loading} variant="accent" />

      <TouchableOpacity onPress={() => alert("Código reenviado!")}>
        <Text style={[styles.resend, { color: colors.tint }]}>Reenviar código</Text>
      </TouchableOpacity>
    </AuthScreenLayout>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 24,
  },
  error: {
    textAlign: "center",
    marginBottom: 10,
  },
  resend: {
    marginTop: 16,
    textAlign: "center",
    fontWeight: "600",
  },
});
