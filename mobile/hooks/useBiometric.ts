import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { getItem, setItem, removeItem } from "@/utils/storage";

const BIOMETRIC_ENABLED_KEY = "biometricEnabled";

export function useBiometric() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    checkAvailability();
  }, []);

  const checkAvailability = async () => {
    // LocalAuthentication has no web support — skip entirely on browser
    if (Platform.OS === "web") return;

    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const enabled = await getItem(BIOMETRIC_ENABLED_KEY);

    setIsAvailable(compatible && enrolled);
    setIsEnabled(enabled === "true");
  };

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") return false;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirme sua identidade",
      cancelLabel: "Cancelar",
      fallbackLabel: "Usar senha",
    });

    return result.success;
  }, []);

  const enable = useCallback(async () => {
    await setItem(BIOMETRIC_ENABLED_KEY, "true");
    setIsEnabled(true);
  }, []);

  const disable = useCallback(async () => {
    await removeItem(BIOMETRIC_ENABLED_KEY);
    setIsEnabled(false);
  }, []);

  return { isAvailable, isEnabled, authenticate, enable, disable };
}
