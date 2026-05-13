import {
  View,
  TextInput,
  Image,
  StyleSheet,
  TextInputProps,
  Animated,
  Platform,
} from "react-native";

import { useState, useRef } from "react";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

interface InputLineProps extends TextInputProps {
  icon?: any;
  placeholder: string;
}

export default function InputLine({
  icon,
  placeholder,
  ...rest
}: InputLineProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [isFocused, setIsFocused] = useState(false);
  const lineColorAnim = useRef(new Animated.Value(0)).current;

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

  const inputOverrideStyle: any =
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
        {icon && (
          <Image
            source={icon}
            style={[styles.icon, { tintColor: colors.icon }]}
            resizeMode="contain"
          />
        )}
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
          {...rest}
        />
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
    alignItems: "center",
    paddingHorizontal: 0,
    paddingVertical: 12,
  },
  icon: {
    width: 20,
    height: 20,
    marginRight: 12,
    marginLeft: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingRight: 8,
    outline: 'none', // Remove browser focus outline
  },
  underline: {
    height: 1.5,
    marginTop: 4,
  },
});
