import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useState, useMemo } from "react";
import { router, useLocalSearchParams } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import ThemeToggle from "@/components/ThemeToggle";
import { Colors } from "@/constants/theme";
import { requestPasswordReset, verifyPasswordResetCode } from "@/app/services/api";

export default function VerifyCode() {

  const { theme } = useTheme();
  const colors = Colors[theme];
  const { screenSize, maxWidth } = useResponsive();

  const contentPadding = responsiveValue(screenSize, {
    small: 18,
    medium: 22,
    large: 24,
    tablet: 28,
  });

  const titleTopMargin = responsiveValue(screenSize, {
    small: 120,
    medium: 140,
    large: 150,
    tablet: 180,
  });

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { email } = useLocalSearchParams<{ email?: string }>();
  const normalizedEmail = typeof email === "string" ? email : "";

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "flex-start",
      padding: contentPadding,
      backgroundColor: colors.background,
    },
    topBar: {
      position: "absolute",
      top: 50,
      left: 20,
      right: 20,
      height: 48,
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      zIndex: 10,
    },
    title: {
      fontSize: 32,
      fontWeight: "bold",
      textAlign: "center",
      marginTop: titleTopMargin,
      marginBottom: 16,
      color: colors.text,
    },
    subtitle: {
      fontSize: 16,
      textAlign: "center",
      marginBottom: 32,
      color: colors.tint,
      lineHeight: 24,
    },
    error: {
      color: colors.error,
      textAlign: "center",
      marginBottom: 10,
    },
    resend: {
      marginTop: 16,
      textAlign: "center",
      color: colors.tint,
      fontWeight: "600",
    },
  }), [colors, contentPadding, titleTopMargin]);

  const handleVerify = async () => {
    setError("");

    if (!normalizedEmail) {
      setError("E-mail inválido. Volte e solicite um novo código.");
      return;
    }

    if (!code || code.length !== 6) {
      setError("Digite um código válido com 6 dígitos");
      return;
    }

    setLoading(true);

    try {
      await verifyPasswordResetCode(normalizedEmail, code.trim());
      router.push({
        pathname: "/reset-password",
        params: { email: normalizedEmail, codigo: code.trim() },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código inválido ou expirado.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");

    if (!normalizedEmail) {
      setError("E-mail inválido. Volte e solicite um novo código.");
      return;
    }

    setLoading(true);

    try {
      await requestPasswordReset(normalizedEmail);
      setError("Código reenviado com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reenviar código.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.container, { backgroundColor: colors.background, width: "100%", maxWidth, alignSelf: "center" }]}>

      <View style={styles.topBar}>
        <ThemeToggle />
      </View>

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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Validar código"
        onPress={handleVerify}
        loading={loading}
        variant="primary"
      />

      <TouchableOpacity onPress={handleResend} disabled={loading}>
        <Text style={styles.resend}>
          Reenviar código
        </Text>
      </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

