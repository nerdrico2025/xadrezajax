import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";
import { Colors } from "@/constants/theme";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import ThemeToggle from "@/components/ThemeToggle";

export default function ForgotPassword() {

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

  const styles = StyleSheet.create({
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
      justifyContent: "space-between",
      alignItems: "center",
      zIndex: 10,
    },
    backButton: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    backButtonText: {
      fontSize: 28,
      lineHeight: 28,
      fontWeight: "600",
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
      marginBottom: 16,
    },
    actionContainer: {
      marginTop: 12,
    },
  });

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

      // vai para verificação
      router.push("/verify-code");

    }, 1500);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.container, { backgroundColor: colors.background, width: "100%", maxWidth, alignSelf: "center" }]}>          
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.push("/login")} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.backButtonText, { color: colors.tint }]}>←</Text>
            </TouchableOpacity>

            <ThemeToggle />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Recuperar Senha</Text>

          <Text style={styles.subtitle}>
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

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actionContainer}>
            <Button
              title="Enviar código"
              onPress={handleSendCode}
              loading={loading}
              variant="primary"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}