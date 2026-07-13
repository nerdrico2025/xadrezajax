import { type ComponentProps, useRef } from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "../hooks/useTheme";
import { Colors } from "../constants/theme";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  // "accent": CTAs de conversão (assinar, upgrade) — Dourado AJAX (RF-VISUAL-01)
  variant?: "primary" | "secondary" | "accent";
  iconName?: IoniconsName;
};

export default function Button({
  title,
  onPress,
  loading = false,
  variant = "primary",
  iconName,
}: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const palette = {
    primary: {
      background: colors.buttonPrimary,
      text: colors.buttonPrimaryText,
      border: "transparent",
    },
    secondary: {
      background: colors.buttonSecondary,
      text: colors.buttonSecondaryText,
      border: colors.buttonBorder,
    },
    accent: {
      background: colors.accent,
      text: colors.accentText,
      border: "transparent",
    },
  }[variant];
  const textColor = palette.text;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[
          styles.button,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
          },
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <View style={styles.content}>
            {iconName && (
              <Ionicons
                name={iconName}
                size={20}
                color={textColor}
                style={styles.icon}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            )}

            <Text style={[styles.text, { color: textColor }]}>{title}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    borderWidth: 1,
    marginVertical: 10,
  },
  text: {
    fontWeight: "bold",
    fontSize: 18,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    marginRight: 10,
  },
});
