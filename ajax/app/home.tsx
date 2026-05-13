import { View, Text } from "react-native";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

export default function Home() {

  const { theme } = useTheme();
  const colors = Colors[theme];

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ color: colors.text }}>Home</Text>
    </View>
  );
}