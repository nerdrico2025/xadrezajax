import { useState, useEffect, useCallback } from "react";
import { loadSoundSettings, isSoundEnabled, setSoundEnabled } from "@/utils/soundSettings";

export function useSoundSettings() {
  const [soundEnabled, setSoundEnabledState] = useState(true);

  useEffect(() => {
    loadSoundSettings().then(() => setSoundEnabledState(isSoundEnabled()));
  }, []);

  const toggle = useCallback(async (value: boolean) => {
    setSoundEnabledState(value);
    await setSoundEnabled(value);
  }, []);

  return { soundEnabled, toggle };
}
