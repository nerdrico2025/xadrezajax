import { useCallback, useEffect, useState } from "react";

import { DEFAULT_HUMAN_TIME_SECONDS } from "@/constants/onlineGame";
import {
  getOnlineTimePref,
  loadOnlineTimePref,
  setOnlineTimePref,
} from "@/utils/onlinePrefs";

/**
 * Preferência de tempo de partida online (Ajustes → item 7).
 *
 * Mesmo formato do useSoundSettings. Quem precisa do valor no caminho de um
 * toque (a busca rápida) lê direto de `getOnlineTimePref()` — sem esperar
 * estado de React — e usa este hook só para exibir/editar.
 */
export function useOnlineTimePref() {
  const [seconds, setSeconds] = useState(DEFAULT_HUMAN_TIME_SECONDS);

  useEffect(() => {
    loadOnlineTimePref().then(() => setSeconds(getOnlineTimePref()));
  }, []);

  const select = useCallback(async (value: number) => {
    setSeconds(value);
    await setOnlineTimePref(value);
  }, []);

  return { seconds, select };
}
