import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import AuthScreenLayout from "@/components/AuthScreenLayout";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/services/api";
import { useBiometric } from "@/hooks/useBiometric";

export default function Login() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { signIn } = useAuth();
  const { isAvailable, isEnabled, authenticate, enable } = useBiometric();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {

    setError("");

    if (!email || !password) {
      setError("Preencha todos os campos");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data?.detail || "Email ou senha inválidos");
        return;
      }

      await signIn(data.access, data.refresh, data.user);

      if (isAvailable && !isEnabled) {
        Alert.alert(
          "Ativar biometria",
          "Deseja usar digital ou Face ID para entrar nas próximas vezes?",
          [
            { text: "Agora não", style: "cancel" },
            { text: "Ativar", onPress: enable },
          ]
        );
      }

      router.replace("/home");

    } catch (err) {
      console.log("💥 ERRO:", err);
      setError("Erro de conexão com servidor");
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    const success = await authenticate();
    if (success) {
      router.replace("/home");
    } else {
      setError("Autenticação biométrica falhou");
    }
  };

  return (
    <AuthScreenLayout showLogo>
      <Text style={[styles.subtitle, { color: colors.text }]}>Entrar</Text>

      <InputLine
        iconName="mail-outline"
        placeholder="Digite seu Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />

      <InputLine
        iconName="lock-closed-outline"
        placeholder="Digite sua Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <View style={styles.rowBetween}>
        {error ? (
          <Text style={[styles.error, { color: colors.error }]}>
            {error}
          </Text>
        ) : (
          <View />
        )}

        <TouchableOpacity onPress={() => router.push("/forgot-password")}>
          <Text style={[styles.forgot, { color: colors.tabIconDefault }]}>
            Esqueceu a senha?
          </Text>
        </TouchableOpacity>
      </View>
      
      <Button title="Acessar" onPress={handleLogin} loading={loading} />

      {isAvailable && isEnabled && (
        <TouchableOpacity
          style={styles.biometricButton}
          onPress={handleBiometricLogin}
        >
          <Ionicons name="finger-print" size={32} color={colors.primary} />
          <Text style={[styles.biometricText, { color: colors.primary }]}>
            Entrar com biometria
          </Text>
        </TouchableOpacity>
      )}

      <Divider text="ou" />
      <Button
        title="Entrar com Google"
        onPress={() => {
          setError("");
          setGoogleLoading(true);

          setTimeout(() => {
            setGoogleLoading(false);
            router.replace("/home");
          }, 2000);
        }}
        loading={googleLoading}
        variant="secondary"
        iconName="logo-google"
      />
      <TouchableOpacity onPress={() => router.push("/register")}>
        <Text style={[styles.link, { color: colors.tabIconDefault }]}>
          Ainda não possui conta? Cadastre-se
        </Text>
      </TouchableOpacity>
    </AuthScreenLayout>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: 36,
    fontWeight: "bold",
    marginBottom: 10,
  },
  error: {
    marginBottom: 10,
    fontWeight: "600",
  },
  link: {
    textAlign: "center",
    marginTop: 20,
    fontWeight: "600",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  
  forgot: {
    fontWeight: "600",
    fontSize: 12,
  },
  biometricButton: {
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  biometricText: {
    fontSize: 14,
    fontWeight: "600",
  },
});