import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";

import { useState } from "react";
import { router } from "expo-router";

export default function Login() {

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [error, setError] = useState("");

  const handleLogin = () => {

    setError("");

    // validação básica
    if (!email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    setLoading(true);

    // simulação backend
    setTimeout(() => {

      // usuário fake
      const fakeEmail = "admin@ajax.com";
      const fakePassword = "123456";

      if (
        email === fakeEmail &&
        password === fakePassword
      ) {

        setLoading(false);

        router.replace("/home");

      } else {

        setLoading(false);

        setError("Email ou senha inválidos");
      }

    }, 2000);
  };

  // login google fake
  const handleGoogleLogin = () => {

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
        AJAX
      </Text>

      <Text style={styles.subtitle}>
        Clube de Xadrez
      </Text>

      <TextInput
        placeholder="Email"
        placeholderTextColor="#777"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />

      <TextInput
        placeholder="Senha"
        placeholderTextColor="#777"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />
      
      {/* ESQUECI SENHA */}
      
      <TouchableOpacity onPress={() => router.push("/forgot-password")}>
        <Text style={styles.forgot}>
            Esqueci minha senha
        </Text>
      </TouchableOpacity>
      {error ? (
        <Text style={styles.error}>
          {error}
        </Text>
      ) : null}

      {/* LOGIN NORMAL */}
      <TouchableOpacity
        style={styles.button}
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

      {/* LOGIN GOOGLE */}
      <TouchableOpacity
        style={styles.googleButton}
        onPress={handleGoogleLogin}
      >

        {googleLoading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.googleText}>
            Continuar com Google
          </Text>
        )}

      </TouchableOpacity>

      {/* LINK CADASTRO */}
      <TouchableOpacity
        onPress={() => router.push("/register")}
      >
        <Text style={styles.link}>
          Criar conta
        </Text>
      </TouchableOpacity>

      {/* USUÁRIO MOCK */}
      <Text style={styles.fakeUser}>
        admin@ajax.com | 123456
      </Text>

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
    fontSize: 42,
    fontWeight: "bold",
    textAlign: "center",
  },

  subtitle: {
    color: "#1B5F7A",
    textAlign: "center",
    marginBottom: 40,
    letterSpacing: 2,
  },

  input: {
    backgroundColor: "#161616",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    borderRadius: 12,
    padding: 16,
    color: "#FFFFFF",
    marginBottom: 16,
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

  fakeUser: {
    color: "#555",
    textAlign: "center",
    marginTop: 40,
    fontSize: 12,
  },

  forgot: {
  color: "#888",
  textAlign: "right",
  marginBottom: 12,
  },

});