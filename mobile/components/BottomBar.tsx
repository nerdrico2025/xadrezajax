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
  { id: "home",    label: "Início", icon: "home-outline",  iconActive: "home" },
  { id: "play",    label: "Jogar",  icon: null,            iconActive: null, chess: true },
  { id: "profile", label: "Menu",   icon: "menu-outline",  iconActive: "menu" },
];

interface BottomBarProps {
  activeTab?: BottomTab;
  onTabPress?: (tab: BottomTab) => void;
  pendingFriendRequests?: number;
}

export default function BottomBar({
  activeTab = "home",
  onTabPress,
  pendingFriendRequests = 0,
}: BottomBarProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = Colors[theme];

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom + 8,
          backgroundColor: colors.background,
          borderTopColor: colors.divider,
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
            {isActive && (
              <View style={[styles.indicator, { backgroundColor: colors.primary }]} />
            )}

            <View style={styles.iconWrap}>
              {tab.chess ? (
                <Text style={[styles.chessIcon, { color: iconColor }]}>♞</Text>
              ) : (
                <Ionicons
                  name={isActive ? tab.iconActive! : tab.icon!}
                  size={24}
                  color={iconColor}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              )}
              {tab.id === "profile" && pendingFriendRequests > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.error }]}>
                  <Text style={styles.badgeText}>
                    {pendingFriendRequests > 9 ? "9+" : pendingFriendRequests}
                  </Text>
                </View>
              )}
            </View>

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
  iconWrap: {
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#fff",
  },
});
