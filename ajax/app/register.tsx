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
import { useResponsive } from "@/hooks/useResponsive";
import { responsiveValue } from "@/utils/responsive";
import { Images } from "@/constants/images";
import { Colors } from "@/constants/theme";
import Button from "@/components/Button";
import InputLine from "@/components/InputLine";
import Divider from "@/components/Divider";
import ThemeToggle from "@/components/ThemeToggle";

export default function Register() {

  const { theme } = useTheme();
  const colors = Colors[theme];
  const { screenSize, maxWidth } = useResponsive();

  const logoSize = responsiveValue(screenSize, {
    small: 220,
    medium: 250,
    large: 280,
    tablet: 320,
  });

  const contentPadding = responsiveValue(screenSize, {
    small: 18,
    medium: 22,
    large: 24,
    tablet: 28,
  });

  const logoSpacing = responsiveValue(screenSize, {
    small: 10,
    medium: 12,
    large: 14,
    tablet: 16,
  });

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
      padding: contentPadding,
      backgroundColor: colors.background,
    },
    logoContainer: {
      alignItems: "center",
      marginBottom: logoSpacing,
    },
    logo: {
      width: logoSize,
      height: logoSize,
    },
    subtitle: {
      fontSize: 32,
      fontWeight: "bold",
      textAlign: "left",
      marginBottom: 10,
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
        <View style={[styles.container, { backgroundColor: colors.background, width: "100%", maxWidth, alignSelf: "center" }]}>

      <View style={styles.topBar}>
        <ThemeToggle />
      </View>

      <View style={styles.logoContainer}>
        <Image
          source={Images.logoAjax}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.subtitle}>Novo Usuário</Text>

      <InputLine
        iconName="person-outline"
        placeholder="Digite seu Nome"
        value={name}
        onChangeText={setName}
      />

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
        iconName="logo-google"
      />

      <TouchableOpacity onPress={() => router.push("/login")}>        
        <Text style={styles.link}>Já possui uma conta? Faça o login</Text>
      </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

