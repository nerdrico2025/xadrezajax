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
import { Colors } from "@/constants/theme";
import Button from "../components/Button";
import InputLine from "../components/InputLine";
import Divider from "../components/Divider";

const logoAjax = require("../assets/images/logo_ajax.svg");
const userIcon = require("../assets/images/user-bold.svg");
const emailIcon = require("../assets/images/email_icon.svg");
const lockIcon = require("../assets/images/cadeado.svg");
const googleIcon = require("../assets/images/google_icon.svg");
const sunIcon = require("../assets/images/sun.svg");
const moonIcon = require("../assets/images/moon.svg");

export default function Register() {

  const { theme, toggleTheme } = useTheme();
  const colors = Colors[theme];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [error, setError] = useState("");

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      padding: 24,
      backgroundColor: colors.background,
    },
    logoContainer: {
      alignItems: "center",
      marginBottom: 16,
    },
    logo: {
      width: 280,
      height: 280,
    },
    subtitle: {
      fontSize: 32,
      fontWeight: "bold",
      textAlign: "left",
      marginBottom: 22,
      color: colors.background === "#0D0D0D" ? colors.tint : colors.text,
    },
    error: {
      color: colors.error,
      marginBottom: 10,
      textAlign: "left",
      fontWeight: "600",
    },
    link: {
      textAlign: "center",
      marginTop: 18,
      color: colors.tabIconDefault,
      fontWeight: "600",
      fontSize: 14,
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
    topBar: {
      width: "100%",
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
    },
  });

  const handleRegister = () => {

    setError("");

    // validação campos
    if (!name || !email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    // validação senha
    if (password.length < 6) {
      setError("Senha deve ter pelo menos 6 caracteres");
      return;
    }

    setLoading(true);

    // simulação backend
    setTimeout(() => {

      // email já existente fake
      if (email === "admin@ajax.com") {

        setLoading(false);
        setError("Email já cadastrado");
        return;
      }

      // sucesso
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

      <View style={styles.logoContainer}>
        {theme === "light" && (
          <Image
            source={logoAjax}
            style={styles.logo}
            resizeMode="contain"
          />
        )}

        {theme === "dark" && (
          <Image
            source={logoAjax}
            style={[styles.logo, { tintColor: colors.primary }]}
            resizeMode="contain"
          />
        )}
      </View>
      <Text style={styles.subtitle}>Novo Usuário</Text>

      <InputLine
        icon={userIcon}
        placeholder="Digite seu Nome"
        value={name}
        onChangeText={setName}
      />

      <InputLine
        icon={emailIcon}
        placeholder="Digite seu Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />

      <InputLine
        icon={lockIcon}
        placeholder="Digite sua Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

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
        icon={googleIcon}
      />

      <TouchableOpacity onPress={() => router.push("/login")}>        
        <Text style={styles.link}>Já possui uma conta? Faça o login</Text>
      </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

