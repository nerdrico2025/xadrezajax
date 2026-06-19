import { type ComponentProps } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

export type BottomTab = "home" | "play" | "profile";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

interface TabItem {
  id: BottomTab;
  label: string;
  icon: IoniconsName | null;
  iconActive: IoniconsName | null;
  chess?: boolean;
}

const TABS: TabItem[] = [
  { id: "home", label: "Home", icon: "home-outline", iconActive: "home" },
  { id: "play", label: "Jogar", icon: null, iconActive: null, chess: true },
  { id: "profile", label: "Menu", icon: "menu-outline", iconActive: "menu" },
];

interface BottomBarProps {
  activeTab?: BottomTab;
  onTabPress?: (tab: BottomTab) => void;
}

export default function BottomBar({
  activeTab = "home",
  onTabPress,
}: BottomBarProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = Colors[theme];

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: colors.background,
          borderTopColor: theme === "dark" ? "#2A2D2E" : "#E8E8E8",
        },
      ]}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const iconColor = isActive ? colors.primary : colors.icon;

        return (
          <Pressable
            key={tab.id}
            style={({ pressed }) => [
              styles.tab,
              pressed && styles.tabPressed,
            ]}
            onPress={() => onTabPress?.(tab.id)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
          >
            {tab.chess ? (
              <Text style={[styles.chessIcon, { color: iconColor }]}>♞</Text>
            ) : (
              <Ionicons
                name={isActive ? tab.iconActive! : tab.icon!}
                size={tab.id === "profile" ? 34 : 28}
                color={iconColor}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            )}

            {isActive && (
              <View
                style={[styles.indicator, { backgroundColor: colors.primary }]}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  tabPressed: {
    opacity: 0.7,
  },
  chessIcon: {
    fontSize: 36,
    lineHeight: 40,
  },
  indicator: {
    position: "absolute",
    top: 0,
    width: 28,
    height: 3,
    borderRadius: 2,
  },
});
