import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { getItem, setItem } from "@/utils/storage";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";

const AVATAR_KEY = "userAvatar";

export default function ProfileScreen() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { signOut } = useAuth();

  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const loadAvatar = useCallback(async () => {
    const saved = await getItem(AVATAR_KEY);
    if (saved) setAvatarUri(saved);
  }, []);

  useEffect(() => {
    loadAvatar();
  }, [loadAvatar]);

  const handlePickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permissão necessária",
        "Precisamos de acesso à sua galeria para trocar a foto de perfil."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      await setItem(AVATAR_KEY, uri);
      setAvatarUri(uri);
    }
  }, []);

  const handleTakePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permissão necessária",
        "Precisamos de acesso à câmera para tirar uma foto."
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      await setItem(AVATAR_KEY, uri);
      setAvatarUri(uri);
    }
  }, []);

  const handleChangePhoto = useCallback(() => {
    Alert.alert("Foto de perfil", "Escolha uma opção", [
      { text: "Câmera", onPress: handleTakePhoto },
      { text: "Galeria", onPress: handlePickImage },
      { text: "Cancelar", style: "cancel" },
    ]);
  }, [handleTakePhoto, handlePickImage]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Pressable style={styles.avatarWrapper} onPress={handleChangePhoto}>
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={styles.avatar}
            contentFit="cover"
            cachePolicy="memory"
          />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: colors.buttonSecondary }]}>
            <Ionicons name="person" size={48} color={colors.icon} />
          </View>
        )}

        <View style={[styles.cameraIcon, { backgroundColor: colors.primary }]}>
          <Ionicons name="camera" size={14} color="#fff" />
        </View>
      </Pressable>

      <Text style={[styles.changePhotoText, { color: colors.primary }]}>
        Trocar foto
      </Text>

      <View style={[styles.divider, { backgroundColor: colors.buttonSecondary }]} />

      <Pressable style={styles.logoutButton} onPress={signOut}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={[styles.logoutText, { color: colors.error }]}>Sair</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingTop: 48,
  },
  avatarWrapper: {
    position: "relative",
    marginBottom: 8,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraIcon: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  changePhotoText: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 32,
  },
  divider: {
    width: "90%",
    height: 1,
    marginBottom: 16,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
