import { TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const colors = Colors[theme];

  return (
    <TouchableOpacity
      onPress={toggleTheme}
      style={styles.button}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={
        theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"
      }
    >
      <Ionicons
        name={theme === "light" ? "moon-outline" : "sunny-outline"}
        size={24}
        color={colors.icon}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
