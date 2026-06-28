import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// On mobile: uses SecureStore (Android Keystore / iOS Keychain — encrypted at OS level)
// On web: falls back to localStorage (not encrypted — acceptable for dev/testing only)

export async function getItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return localStorage.getItem(key);
    }
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    // silently fail — caller should handle missing token via auth flow
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    // item may already be absent
  }
}
