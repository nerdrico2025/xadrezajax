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

export default function ForgotPassword() {

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
    <View style={styles.container}>

      <Text style={styles.title}>Recuperar Senha</Text>

      <Text style={styles.subtitle}>
        Digite seu email para receber o código
      </Text>

      <TextInput
        placeholder="Email"
        placeholderTextColor="#777"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={styles.button}
        onPress={handleSendCode}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Enviar código</Text>
        )}
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
    color: "#FFF",
    fontSize: 32,
    textAlign: "center",
    fontWeight: "bold",
  },
  subtitle: {
    color: "#1B5F7A",
    textAlign: "center",
    marginBottom: 40,
  },
  input: {
    backgroundColor: "#161616",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    borderRadius: 12,
    padding: 16,
    color: "#FFF",
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#1B5F7A",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    minHeight: 58,
  },
  buttonText: {
    color: "#FFF",
    fontWeight: "bold",
  },
  error: {
    color: "#FF4D4D",
    textAlign: "center",
    marginBottom: 10,
  },
});