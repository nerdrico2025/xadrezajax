import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";

import { ThemeProvider } from "@/context/ThemeContext";

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}