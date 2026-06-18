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
  icon: IoniconsName;
  iconActive: IoniconsName;
}

const TABS: TabItem[] = [
  { id: "home", label: "Home", icon: "home-outline", iconActive: "home" },
  {
    id: "play",
    label: "Jogar",
    icon: "grid-outline",
    iconActive: "grid",
  },
  {
    id: "profile",
    label: "Menu",
    icon: "menu-outline",
    iconActive: "menu",
  },
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
            <Ionicons
              name={isActive ? tab.iconActive : tab.icon}
              size={24}
              color={iconColor}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text
              style={[
                styles.label,
                {
                  color: isActive ? colors.primary : colors.secondary,
                  fontWeight: isActive ? "700" : "500",
                },
              ]}
            >
              {tab.label}
            </Text>
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
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 4,
  },
  tabPressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 12,
  },
  indicator: {
    position: "absolute",
    top: 0,
    width: 28,
    height: 3,
    borderRadius: 2,
  },
});
