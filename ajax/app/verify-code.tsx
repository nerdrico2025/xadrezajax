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

const sunIcon = require("../assets/images/sun.svg");
const moonIcon = require("../assets/images/moon.svg");

export default function VerifyCode() {

  const { theme, toggleTheme } = useTheme();
  const colors = Colors[theme];

  const [code, setCode] = useState("");
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

      <TouchableOpacity onPress={() => alert("Código reenviado!")}>
        <Text style={styles.resend}>
          Reenviar código
        </Text>
      </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

