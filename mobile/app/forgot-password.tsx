import { Text, StyleSheet } from "react-native";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import AuthScreenLayout from "@/components/AuthScreenLayout";
import AuthBackButton from "@/components/AuthBackButton";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import { Colors } from "@/constants/theme";

export default function ForgotPassword() {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendCode = () => {
    setError("");

    if (!email) {
      setError("Digite seu email");
      return;
    }

    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      router.push("/verify-code");
    }, 1500);
  };

  return (
    <AuthScreenLayout leftAction={<AuthBackButton onPress={() => router.push("/login")} />}>
      <Text style={[styles.title, { color: colors.text }]}>Recuperar Senha</Text>

      <Text style={[styles.subtitle, { color: colors.tint }]}>
        Enviaremos um código para o seu email cadastrado. Use-o para redefinir a senha.
      </Text>

      <InputLine
        iconName="mail-outline"
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

      <Button
        title="Enviar código"
        onPress={handleSendCode}
        loading={loading}
        variant="primary"
      />
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
    marginBottom: 16,
  },
});
