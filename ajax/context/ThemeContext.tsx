import { createContext, useState, useEffect, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";

type ThemeOption = "light" | "dark";

interface ThemeContextData {
  theme: ThemeOption | null;
  toggleTheme: () => Promise<void>;
  resetToSystem: () => Promise<void>;
  userPreference: ThemeOption | null;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeContext = createContext<ThemeContextData>({
  theme: null,
  toggleTheme: async () => {},
  resetToSystem: async () => {},
  userPreference: null,
});

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemTheme = useColorScheme(); // dark ou light

  const [theme, setTheme] = useState<ThemeOption | null>(
    systemTheme as ThemeOption | null,
  );
  const [userPreference, setUserPreference] = useState<ThemeOption | null>(null);

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    const savedTheme = await AsyncStorage.getItem("theme");

    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
      setUserPreference(savedTheme);
    } else {
      setTheme(systemTheme as ThemeOption | null);
    }
  };

  // atualiza se o sistema mudar (e usuário não tiver escolhido)
  useEffect(() => {
    if (!userPreference) {
      setTheme(systemTheme as ThemeOption | null);
    }
  }, [systemTheme, userPreference]);

  const toggleTheme = async () => {
    const newTheme: ThemeOption = theme === "dark" ? "light" : "dark";

    setTheme(newTheme);
    setUserPreference(newTheme);
    await AsyncStorage.setItem("theme", newTheme);
  };

  const resetToSystem = async () => {
    setUserPreference(null);
    setTheme(systemTheme as ThemeOption | null);
    await AsyncStorage.removeItem("theme");
  };

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, resetToSystem, userPreference }}
    >
      {children}
    </ThemeContext.Provider>
  );
}