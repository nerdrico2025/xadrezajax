import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TOP_BAR_BACKGROUND = "#1A1A1A";
const TOP_BAR_TEXT = "#FFFFFF";

interface TopBarProps {
  title?: string;
}

export default function TopBar({ title = "Xadrez" }: TopBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: TOP_BAR_BACKGROUND },
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  content: {
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: TOP_BAR_TEXT,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
