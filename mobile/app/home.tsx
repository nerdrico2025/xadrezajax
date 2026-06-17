import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";

import TopBar from "@/components/TopBar";
import BottomBar, { type BottomTab } from "@/components/BottomBar";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

import GameScreen from "@/screen/game/GameScreen";
import ProfileScreen from "@/screen/profile/ProfileScreen";

export default function Home() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const [activeTab, setActiveTab] = useState<BottomTab>("home");

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TopBar />

      <View style={styles.content}>
        {/* HOME */}
        {activeTab === "home" && (
          <View style={styles.center}>
            <Text style={[styles.screenTitle, { color: colors.text }]}>
              Home
            </Text>
          </View>
        )}

        {/* JOGO */}
        {activeTab === "play" && (
          <View style={styles.gameContainer}>
            <GameScreen />
          </View>
        )}

        {/* PERFIL */}
        {activeTab === "profile" && <ProfileScreen />}
      </View>

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

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  gameContainer: {
    flex: 1,
  },

  screenTitle: {
    fontSize: 24,
    fontWeight: "600",
  },
});