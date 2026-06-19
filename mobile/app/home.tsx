import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import TopBar from "@/components/TopBar";
import BottomBar, { type BottomTab } from "@/components/BottomBar";
import OfflineBanner from "@/components/OfflineBanner";
import DifficultyModal, { type Difficulty } from "@/components/DifficultyModal";
import ColorPickerModal, { type PlayerColor } from "@/components/ColorPickerModal";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

import GameScreen from "@/screen/game/GameScreen";
import ProfileScreen from "@/screen/profile/ProfileScreen";
import MenuBottomSheet from "@/presentation/components/MenuBottomSheet";
import { gameMenu, profileMenu } from "@/presentation/config/menuConfigs";

type ActiveMenu = "game" | "profile" | null;
type ActiveScreen = "home" | "play" | "profile";

export default function Home() {
  const { theme } = useTheme();
  const colors = Colors[theme];

  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>("home");
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [showDifficulty, setShowDifficulty] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [playerColor, setPlayerColor] = useState<PlayerColor>("w");
  const [gameKey, setGameKey] = useState(0);

  const handleCloseMenu = useCallback(() => setActiveMenu(null), []);

  const handleTabPress = useCallback((tab: BottomTab) => {
    setActiveTab(tab);
    if (tab === "play") {
      setActiveMenu("game");
    } else if (tab === "profile") {
      setActiveMenu("profile");
    } else {
      setActiveScreen("home");
    }
  }, []);

  const handleSelectDifficulty = useCallback((selected: Difficulty) => {
    setDifficulty(selected);
    setShowDifficulty(false);
    setShowColorPicker(true);
  }, []);

  const handleSelectColor = useCallback((selected: PlayerColor) => {
    setPlayerColor(selected);
    setShowColorPicker(false);
    setActiveScreen("play");
    setGameKey((k) => k + 1);
  }, []);

  const currentMenu = (() => {
    if (activeMenu === "game")
      return gameMenu({
        onQuickMatch: () => setShowDifficulty(true),
      });
    if (activeMenu === "profile")
      return profileMenu({
        onProfile: () => setActiveScreen("profile"),
      });
    return null;
  })();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TopBar />
      <OfflineBanner />

      <View style={styles.content}>
        {activeScreen === "home" && (
          <View style={styles.center}>
            <Text style={[styles.screenTitle, { color: colors.text }]}>
              Home
            </Text>
          </View>
        )}

        {activeScreen === "play" && (
          <View style={styles.gameContainer}>
            <GameScreen
              key={gameKey}
              difficulty={difficulty}
              playerColor={playerColor}
              onLeave={() => setActiveScreen("home")}
            />
          </View>
        )}

        {activeScreen === "profile" && <ProfileScreen />}
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

      <DifficultyModal
        visible={showDifficulty}
        onSelect={handleSelectDifficulty}
        onCancel={() => setShowDifficulty(false)}
      />

      <ColorPickerModal
        visible={showColorPicker}
        onSelect={handleSelectColor}
        onCancel={() => setShowColorPicker(false)}
      />
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
