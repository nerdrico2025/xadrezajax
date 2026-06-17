import { useCallback, useEffect, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const BIOMETRIC_ENABLED_KEY = "biometricEnabled";

export function useBiometric() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    checkAvailability();
  }, []);

  const checkAvailability = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);

    setIsAvailable(compatible && enrolled);
    setIsEnabled(enabled === "true");
  };

  const authenticate = useCallback(async (): Promise<boolean> => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirme sua identidade",
      cancelLabel: "Cancelar",
      fallbackLabel: "Usar senha",
    });

    return result.success;
  }, []);

  const enable = useCallback(async () => {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
    setIsEnabled(true);
  }, []);

  const disable = useCallback(async () => {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    setIsEnabled(false);
  }, []);

  return { isAvailable, isEnabled, authenticate, enable, disable };
}
