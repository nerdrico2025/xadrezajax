import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from "react-native";

import { useState } from "react";
import { router } from "expo-router";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

const sunIcon = require("../assets/images/sun.svg");
const moonIcon = require("../assets/images/moon.svg");
const logoAjax = require("../assets/images/logo_ajax.svg");
const emailIcon = require("../assets/images/email_icon.svg");
const lockIcon = require("../assets/images/cadeado.svg");
const googleIcon = require("../assets/images/google_icon.svg");

export default function Login() {

  const { theme, toggleTheme } = useTheme();
  const colors = Colors[theme ?? "light"];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [error, setError] = useState("");

  const handleLogin = () => {

    setError("");

    if (!email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    setLoading(true);

    setTimeout(() => {

      const fakeEmail = "admin@ajax.com";
      const fakePassword = "123456";

      if (email === fakeEmail && password === fakePassword) {

        setLoading(false);
        router.replace("/home");

      } else {

        setLoading(false);
        setError("Email ou senha inválidos");
      }

    }, 2000);
  };

  const handleGoogleLogin = () => {

    setError("");
    setGoogleLoading(true);

    setTimeout(() => {
      setGoogleLoading(false);
      router.replace("/home");
    }, 2000);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      {/* BOTÃO TEMA */}
      <TouchableOpacity onPress={toggleTheme} style={styles.themeButton}>
        <Image
          source={theme === "light" ? moonIcon : sunIcon}
          style={styles.themeIcon}
          resizeMode="contain"
        />
      </TouchableOpacity>

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
          style={[styles.logo, { tintColor: "#1B5F7A" }]}
          resizeMode="contain"
        />
      )}

      <View style={[
        styles.inputContainer,
        {
          borderColor: colors.icon,
          backgroundColor: colors.background,
        },
      ]}>
        <Image
          source={emailIcon}
          style={[styles.inputIcon, { tintColor: colors.icon }]}
        />
        <TextInput
          placeholder="Email"
          placeholderTextColor={colors.icon}
          style={[
            styles.input,
            {
              color: colors.text,
            },
          ]}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
        />
      </View>

      <View style={[
        styles.inputContainer,
        {
          borderColor: colors.icon,
          backgroundColor: colors.background,
        },
      ]}>
        <Image
          source={lockIcon}
          style={[styles.inputIcon, { tintColor: colors.icon }]}
        />
        <TextInput
          placeholder="Senha"
          placeholderTextColor={colors.icon}
          secureTextEntry
          style={[
            styles.input,
            {
              color: colors.text,
            },
          ]}
          value={password}
          onChangeText={setPassword}
        />
      </View>

      <TouchableOpacity onPress={() => router.push("/forgot-password")}>
        <Text style={[styles.forgot, { color: colors.icon }]}>
          Esqueci minha senha
        </Text>
      </TouchableOpacity>

      {error ? (
        <Text style={styles.error}>
          {error}
        </Text>
      ) : null}

      {/* LOGIN */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.tint }]}
        onPress={handleLogin}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>
            Entrar
          </Text>
        )}
      </TouchableOpacity>

      {/* GOOGLE */}
      <TouchableOpacity
        style={[
          styles.googleButton,
          {
            borderColor: colors.icon,
            backgroundColor: colors.background,
          },
        ]}
        onPress={handleGoogleLogin}
      >
        {googleLoading ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <>
            <Image source={googleIcon} style={styles.googleIcon} />
            <Text style={[styles.googleText, { color: colors.text }]}>
              Continuar com Google
            </Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("/register")}>
        <Text style={[styles.link, { color: colors.icon }]}>
          Ainda não possui uma conta? Cadastre-se
        </Text>
      </TouchableOpacity>

      <Text style={styles.fakeUser}>
        admin@ajax.com | 123456
      </Text>

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },

  themeButton: {
    position: "absolute",
    top: 50,
    right: 20,
  },

  title: {
    fontSize: 42,
    fontWeight: "bold",
    textAlign: "center",
  },

  subtitle: {
    textAlign: "center",
    marginBottom: 40,
    letterSpacing: 2,
  },

  input: {
    flex: 1,
    padding: 0,
  },

  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },

  inputIcon: {
    width: 20,
    height: 20,
    marginRight: 12,
  },

  button: {
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 58,
    marginTop: 8,
  },

  buttonText: {
    color: "#FFFFFF",
    fontWeight: "bold",
    fontSize: 16,
  },

  googleButton: {
    marginTop: 16,
    borderWidth: 1,
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 58,
    flexDirection: "row",
  },

  googleIcon: {
    width: 20,
    height: 20,
    marginRight: 12,
  },

  googleText: {
    fontWeight: "600",
    fontSize: 16,
  },

  link: {
    textAlign: "center",
    marginTop: 24,
  },

  error: {
    color: "#FF4D4D",
    marginBottom: 10,
    textAlign: "center",
  },

  fakeUser: {
    color: "#555",
    textAlign: "center",
    marginTop: 40,
    fontSize: 12,
  },

  forgot: {
    textAlign: "right",
    marginBottom: 12,
  },

  themeIcon: {
    width: 28,
    height: 28,
  },

  logo: {
    width: 300,
    height: 300,
    alignSelf: "center",
    marginBottom: 15,
  },

});