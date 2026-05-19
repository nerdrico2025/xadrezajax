import { useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";

import TopBar from "@/components/TopBar";
import BottomBar, { type BottomTab } from "@/components/BottomBar";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

const TAB_CONTENT: Record<BottomTab, string> = {
  home: "Home",
  play: "Jogar",
  profile: "Perfil",
};

export default function Home() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const [activeTab, setActiveTab] = useState<BottomTab>("home");

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TopBar />

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <Text style={[styles.screenTitle, { color: colors.text }]}>
          {TAB_CONTENT[activeTab]}
        </Text>
      </ScrollView>

      <BottomBar activeTab={activeTab} onTabPress={setActiveTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: "600",
  },
});
