import { createContext, useState, useEffect, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";

type ThemeOption = "light" | "dark";

interface ThemeContextData {
  theme: ThemeOption;
  toggleTheme: () => Promise<void>;
  resetToSystem: () => Promise<void>;
  userPreference: ThemeOption | null;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeContext = createContext<ThemeContextData>({
  theme: "light",
  toggleTheme: async () => {},
  resetToSystem: async () => {},
  userPreference: null,
});

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemTheme = useColorScheme(); // dark ou light

  const [theme, setTheme] = useState<ThemeOption>(
    "light", // start with light theme by default
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
      const defaultTheme = (systemTheme as ThemeOption) || "light";
      setTheme(defaultTheme);
    }
  };

  // atualiza se o sistema mudar (e usuário não tiver escolhido)
  useEffect(() => {
    if (!userPreference) {
      const defaultTheme = (systemTheme as ThemeOption) || "light";
      setTheme(defaultTheme);
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
    const defaultTheme = (systemTheme as ThemeOption) || "light";
    setTheme(defaultTheme);
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