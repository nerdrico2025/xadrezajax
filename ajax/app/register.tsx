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

const userIcon = require("../assets/images/user-bold.svg");
const emailIcon = require("../assets/images/email_icon.svg");
const lockIcon = require("../assets/images/cadeado.svg");
const googleIcon = require("../assets/images/google_icon.svg");

export default function Register() {

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [error, setError] = useState("");

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
    <View style={styles.container}>

      <Text style={styles.title}>
        Criar Conta
      </Text>

      <Text style={styles.subtitle}>
        Cadastro de Usuário
      </Text>

      <View style={styles.inputContainer}>
        <Image source={userIcon} style={styles.inputIcon} />
        <TextInput
          placeholder="Nome"
          placeholderTextColor="#777"
          style={styles.input}
          value={name}
          onChangeText={setName}
        />
      </View>

      <View style={styles.inputContainer}>
        <Image source={emailIcon} style={styles.inputIcon} />
        <TextInput
          placeholder="Email"
          placeholderTextColor="#777"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.inputContainer}>
        <Image source={lockIcon} style={styles.inputIcon} />
        <TextInput
          placeholder="Senha"
          placeholderTextColor="#777"
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />
      </View>

      {error ? (
        <Text style={styles.error}>
          {error}
        </Text>
      ) : null}

      {/* BOTÃO CADASTRAR */}
      <TouchableOpacity
        style={styles.button}
        onPress={handleRegister}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>
            Cadastrar
          </Text>
        )}
      </TouchableOpacity>

      {/* GOOGLE */}
      <TouchableOpacity
        style={styles.googleButton}
        onPress={handleGoogleRegister}
      >
        {googleLoading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Image source={googleIcon} style={styles.googleIcon} />
            <Text style={styles.googleText}>
              Continuar com Google
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* VOLTAR LOGIN */}
      <TouchableOpacity
        onPress={() => router.push("/login")}
      >
        <Text style={styles.link}>
          Já possui conta? Entrar
        </Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#0A0A0A",
    justifyContent: "center",
    padding: 24,
  },

  title: {
    color: "#FFFFFF",
    fontSize: 36,
    fontWeight: "bold",
    textAlign: "center",
  },

  subtitle: {
    color: "#1B5F7A",
    textAlign: "center",
    marginBottom: 40,
    letterSpacing: 1,
  },

  input: {
    flex: 1,
    color: "#FFFFFF",
  },

  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#161616",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },

  inputIcon: {
    width: 20,
    height: 20,
    marginRight: 12,
    tintColor: "#777",
  },

  button: {
    backgroundColor: "#1B5F7A",
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
    borderColor: "#333",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 58,
    backgroundColor: "#161616",
    flexDirection: "row",
  },

  googleIcon: {
    width: 20,
    height: 20,
    marginRight: 12,
  },

  googleText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },

  link: {
    color: "#AAAAAA",
    textAlign: "center",
    marginTop: 24,
  },

  error: {
    color: "#FF4D4D",
    marginBottom: 10,
    textAlign: "center",
  },

});