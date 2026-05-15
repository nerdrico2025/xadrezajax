import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import Button from "../components/Button";
import InputLine from "../components/InputLine";
import { Colors } from "@/constants/theme";

const lockIcon = require("../assets/images/cadeado.svg");
const sunIcon = require("../assets/images/sun.svg");
const moonIcon = require("../assets/images/moon.svg");

export default function ResetPassword() {

  const { theme, toggleTheme } = useTheme();
  const colors = Colors[theme];

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "flex-start",
      padding: 24,
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
      marginTop: 150,
      marginBottom: 16,
      color: colors.text,
    },
    error: {
      color: colors.error,
      textAlign: "center",
      marginBottom: 10,
    },
    themeButton: {
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
    },
    themeIcon: {
      width: 24,
      height: 24,
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
        <View style={[styles.container, { backgroundColor: colors.background, width: "100%", maxWidth: 400, alignSelf: "center" }]}>

      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={toggleTheme}
          style={styles.themeButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Image
            source={theme === "light" ? moonIcon : sunIcon}
            style={styles.themeIcon}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </View>

      <Text style={[styles.title, { color: colors.text }]}>Nova Senha</Text>

      <InputLine
        icon={lockIcon}
        placeholder="Nova senha"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <InputLine
        icon={lockIcon}
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

