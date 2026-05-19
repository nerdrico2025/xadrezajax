import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  Image,
  Animated,
} from "react-native";

import { useRef } from "react";

import { useTheme } from "../hooks/useTheme";
import { Colors } from "../constants/theme";

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: "primary" | "secondary";
  icon?: any;
};

export default function Button({
  title,
  onPress,
  loading = false,
  variant = "primary",
  icon,
}: Props) {

  const { theme } = useTheme();
  const colors = Colors[theme];

  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
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

  const isPrimary = variant === "primary";

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[
          styles.button,
          {
            backgroundColor: isPrimary
              ? colors.buttonPrimary
              : colors.buttonSecondary,
            borderColor: isPrimary
              ? "transparent"
              : colors.buttonBorder,
          },
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator
            color={
              isPrimary
                ? colors.buttonPrimaryText
                : colors.buttonSecondaryText
            }
          />
        ) : (
          <View style={styles.content}>
            
            {icon && (
              <Image source={icon} style={styles.icon} />
            )}

            <Text
              style={[
                styles.text,
                {
                  color: isPrimary
                    ? colors.buttonPrimaryText
                    : colors.buttonSecondaryText,
                },
              ]}
            >
              {title}
            </Text>

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
  },
  text: {
    fontWeight: "bold",
    fontSize: 16,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 20,
    height: 20,
    marginRight: 10,
  },
});