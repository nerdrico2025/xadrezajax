import { View, Text, StyleSheet } from "react-native";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

interface DividerProps {
  text?: string;
}

export default function Divider({ text }: DividerProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];

  if (text) {
    return (
      <View style={styles.container}>
        <Text
          style={[
            styles.text,
            { color: colors.icon },
          ]}
        >
          {text}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.simpleLine,
        { backgroundColor: colors.icon },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",    justifyContent: "center",    marginVertical: 10,
  },

  text: {
    marginHorizontal: 16,
    fontWeight: "600",
    fontSize: 12,
  },
  simpleLine: {
    height: 1,
    marginVertical: 16,
  },
});
