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
          <Ionicons
            name={iconName}
            size={20}
            color={colors.icon}
            style={styles.icon}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
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
              size={22}
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
    marginBottom: 16,
  },
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 0,
    paddingVertical: 2,
  },
  iconWrapper: {
    width: 20,
    height: 20,
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  icon: {
    marginRight: 12,
    marginBottom: 3,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingRight: 4,
    paddingVertical: 0,
    textAlignVertical: "bottom",
  },
  visibilityToggle: {
    width: 32,
    height: 32,
    marginBottom: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  underline: {
    height: StyleSheet.hairlineWidth,
    marginTop: 1,
  },
});
