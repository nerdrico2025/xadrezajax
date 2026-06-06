import { type ReactNode } from "react";
import {
  View,
  StyleSheet,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import { useTheme } from "@/hooks/useTheme";
import { useAuthLayout } from "@/hooks/useAuthLayout";
import { Colors } from "@/constants/theme";
import AppLogo from "@/components/AppLogo";
import ThemeToggle from "@/components/ThemeToggle";

interface AuthScreenLayoutProps {
  children: ReactNode;
  showLogo?: boolean;
  leftAction?: ReactNode;
  centered?: boolean;
}

export default function AuthScreenLayout({
  children,
  showLogo = false,
  leftAction,
  centered = false,
}: AuthScreenLayoutProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { maxWidth, logoSize, contentPadding, logoSpacing, topBarHeight } =
    useAuthLayout();

  const content = (
    <View
      style={[
        styles.page,
        {
          backgroundColor: colors.background,
          maxWidth,
          paddingHorizontal: contentPadding,
        },
      ]}
    >
      <View style={[styles.topBar, { height: topBarHeight }]}>
        {leftAction ?? <View style={styles.topBarSide} />}
        <ThemeToggle />
      </View>

      <View
        style={[
          styles.body,
          {
            paddingBottom: contentPadding,
            justifyContent: centered ? "center" : "flex-start",
          },
        ]}
      >
        {showLogo && (
          <View style={[styles.logoSlot, { marginBottom: logoSpacing }]}>
            <AppLogo theme={theme} size={logoSize} />
          </View>
        )}

        {children}
      </View>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAwareScrollView
            contentContainerStyle={styles.scrollContent}
            enableOnAndroid
            extraScrollHeight={140}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            keyboardOpeningTime={0}
            enableAutomaticScroll
          >
            {content}
          </KeyboardAwareScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  page: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    minHeight: "100%",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingTop: 8,
  },
  topBarSide: {
    width: 48,
    height: 48,
  },
  body: {
    flex: 1,
    width: "100%",
  },
  logoSlot: {
    width: "100%",
    alignItems: "center",
  },
});