import { useEffect, useState } from "react";
import * as Network from "expo-network";

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const check = async () => {
      const state = await Network.getNetworkStateAsync();
      setIsConnected(state.isConnected ?? true);
    };

    check();
    interval = setInterval(check, 5000);

    return () => clearInterval(interval);
  }, []);

  return { isConnected };
}
