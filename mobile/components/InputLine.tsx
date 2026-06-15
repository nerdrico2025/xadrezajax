import { type ComponentProps } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TextInputProps,
  Animated,
  Platform,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useState, useRef, type ReactNode } from "react";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

interface InputLineProps extends TextInputProps {
  iconName?: IoniconsName;
  iconComponent?: ReactNode;
  placeholder: string;
}

export default function InputLine({
  iconName,
  iconComponent,
  placeholder,
  secureTextEntry,
  ...rest
}: InputLineProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [isFocused, setIsFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const lineColorAnim = useRef(new Animated.Value(0)).current;

  const isPasswordField = secureTextEntry === true;
  const hidePassword = isPasswordField && !passwordVisible;

  const handleFocus = () => {
    setIsFocused(true);
    Animated.timing(lineColorAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    Animated.timing(lineColorAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const lineColor = lineColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.icon, colors.primary],
  });

  const inputOverrideStyle: Record<string, unknown> =
    Platform.OS === "web"
      ? {
          outlineWidth: 0,
          outlineColor: "transparent",
          boxShadow: "none",
        }
      : {};

  const getIconStyle = () => {
    if (iconName === "person-outline") {
      return styles.personIconAdjust;
    }
    if (iconName === "mail-outline") {
      return styles.emailIconAdjust;
    }
    if (iconName === "lock-closed-outline") {
      return styles.lockIconAdjust;
    }
    return {};
  };

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
          },
        ]}
      >
        {iconComponent ? (
          <View style={styles.iconWrapper}>{iconComponent}</View>
        ) : iconName ? (
          <View style={[styles.iconContainer, getIconStyle()]}>
            <Ionicons
              name={iconName}
              size={20}
              color={colors.icon}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </View>
        ) : null}
        
        <TextInput
          placeholder={placeholder}
          placeholderTextColor={colors.icon}
          style={[
            styles.input,
            {
              color: colors.text,
            },
            inputOverrideStyle,
          ]}
          underlineColorAndroid="transparent"
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          onFocus={handleFocus}
          onBlur={handleBlur}
          secureTextEntry={hidePassword}
          {...rest}
        />
        {isPasswordField && (
          <Pressable
            onPress={() => setPasswordVisible((visible) => !visible)}
            style={styles.visibilityToggle}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={
              passwordVisible ? "Ocultar senha" : "Mostrar senha"
            }
          >
            <Ionicons
              name={passwordVisible ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={colors.icon}
            />
          </Pressable>
        )}
      </View>
      <Animated.View
        style={[
          styles.underline,
          {
            backgroundColor: lineColor,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 8,
  },
  container: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    paddingHorizontal: 0,
    position: "relative",
  },
  iconWrapper: {
    width: 20,
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  iconContainer: {
    width: 20,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  personIconAdjust: {
    top: 5,
  },
  emailIconAdjust: {
    top: 8,
  },
  lockIconAdjust: {
    top: 6,
  },

  input: {
    flex: 1,
    fontSize: 16,
    paddingRight: 36,
    marginTop: 19,
    height: "100%",
    margin: 0,
    includeFontPadding: false,
  },
  visibilityToggle: {
    position: "absolute",
    right: 6,
    width: 32,
    height: 32,
    marginTop: 18,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  underline: {
    height: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
});