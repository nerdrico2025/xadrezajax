import { type ComponentProps } from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

export interface IconButtonProps {
  icon: IoniconsName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "filled" | "outline" | "ghost";
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export default function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  variant = "filled",
  accessibilityHint,
  style,
}: IconButtonProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const isFilled = variant === "filled";
  const isOutline = variant === "outline";

  const backgroundColor = isFilled
    ? colors.primary
    : isOutline
      ? "transparent"
      : theme === "dark"
        ? "rgba(255,255,255,0.08)"
        : "rgba(0,0,0,0.05)";

  const borderColor = isOutline ? colors.primary : "transparent";
  const contentColor = isFilled ? colors.buttonPrimaryText : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={contentColor}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
      <Text style={[styles.label, { color: contentColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
