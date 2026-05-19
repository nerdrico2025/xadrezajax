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
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import ThemeToggle from "@/components/ThemeToggle";
import { Colors } from "@/constants/theme";

export default function ResetPassword() {

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

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    error: {
      color: colors.error,
      textAlign: "center",
      marginBottom: 10,
    },
  });

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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.container, { backgroundColor: colors.background, width: "100%", maxWidth, alignSelf: "center" }]}>

      <View style={styles.topBar}>
        <ThemeToggle />
      </View>

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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Salvar"
        onPress={handleReset}
        loading={loading}
        variant="primary"
      />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

