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

export default function ResetPassword() {

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    <View style={styles.container}>

      <Text style={styles.title}>Nova Senha</Text>

      <TextInput
        placeholder="Nova senha"
        placeholderTextColor="#777"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />

      <TextInput
        placeholder="Confirmar senha"
        placeholderTextColor="#777"
        secureTextEntry
        style={styles.input}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleReset}>
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Salvar</Text>
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