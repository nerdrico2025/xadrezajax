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

export default function VerifyCode() {

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    <View style={styles.container}>

      <Text style={styles.title}>Verificação</Text>

      <Text style={styles.subtitle}>
        Digite o código enviado para seu email
      </Text>

      <TextInput
        placeholder="123456"
        placeholderTextColor="#777"
        keyboardType="numeric"
        style={styles.input}
        value={code}
        onChangeText={setCode}
        maxLength={6}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleVerify}>
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>
            Validar código
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => alert("Código reenviado!")}>
        <Text style={styles.resend}>
          Reenviar código
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
    color: "#FFF",
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
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
    textAlign: "center",
    fontSize: 18,
    letterSpacing: 8,
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
  resend: {
    color: "#1B5F7A",
    textAlign: "center",
    marginTop: 20,
  },
});