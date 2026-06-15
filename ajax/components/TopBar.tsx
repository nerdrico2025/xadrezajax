import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { logoutUser } from "@/app/services/api";
import ThemeToggle from "@/components/ThemeToggle";

interface TopBarProps {
  title?: string;
}

export default function TopBar({ title = "Xadrez" }: TopBarProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = Colors[theme];

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.background },
      ]}
    >
      <View style={styles.content}>
        {/* Left spacer for centering title */}
        <View style={styles.sideElement} />

        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

        <View style={styles.rightActions}>
          <ThemeToggle />
          <TouchableOpacity onPress={logoutUser} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={24} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150, 150, 150, 0.1)',
  },
  content: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  sideElement: {
    width: 80, // Approximate width of rightActions to keep title centered
  },
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    width: 80,
    justifyContent: "flex-end",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  logoutButton: {
    marginLeft: 16,
  },
});
