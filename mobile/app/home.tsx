import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import TopBar from "@/components/TopBar";
import BottomBar, { type BottomTab } from "@/components/BottomBar";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import GameScreen from "@/screen/game/GameScreen";
import MenuBottomSheet from "@/presentation/components/MenuBottomSheet";
import {
  competitiveMenu,
  gameMenu,
  profileMenu,
} from "@/presentation/config/menuConfigs";

type ActiveMenu = "game" | "profile" | "competitive" | null;

export default function Home() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);

  const handleCloseMenu = useCallback(() => setActiveMenu(null), []);

  const handleTabPress = useCallback((tab: BottomTab) => {
    setActiveTab(tab);
    if (tab === "play") {
      setActiveMenu("game");
    } else if (tab === "profile") {
      setActiveMenu("profile");
    }
  }, []);

  const currentMenu = (() => {
    if (activeMenu === "game")
      return gameMenu({
        onQuickMatch: () => console.log("Partida rápida"),
        onPlayWithFriend: () => console.log("Jogar com amigo"),
        onPuzzle: () => console.log("Quebra-cabeça"),
      });
    if (activeMenu === "profile")
      return profileMenu({
        onProfile: () => console.log("Perfil"),
        onGame: () => console.log("Jogo"),
        onSubscription: () => console.log("Assinatura"),
        onSettings: () => console.log("Configurações"),
      });
    if (activeMenu === "competitive")
      return competitiveMenu({
        onCompetitions: () => console.log("Competições"),
        onRanking: () => console.log("Ranking"),
        onAchievements: () => console.log("Conquistas"),
        onStats: () => console.log("Estatísticas"),
      });
    return null;
  })();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TopBar />

      <View style={styles.content}>
        {activeTab === "home" && (
          <View style={styles.center}>
            <Text style={[styles.screenTitle, { color: colors.text }]}>
              Home
            </Text>
          </View>
        )}

        {activeTab === "play" && activeMenu === null && (
          <View style={styles.gameContainer}>
            <GameScreen />
          </View>
        )}

        {activeTab === "profile" && (
          <View style={styles.center}>
            <Text style={[styles.screenTitle, { color: colors.text }]}>
              Perfil
            </Text>
          </View>
        )}
      </View>

      <BottomBar activeTab={activeTab} onTabPress={handleTabPress} />

      {currentMenu && (
        <MenuBottomSheet
          visible={activeMenu !== null}
          title={currentMenu.title}
          items={currentMenu.items}
          onClose={handleCloseMenu}
        />
      )}
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