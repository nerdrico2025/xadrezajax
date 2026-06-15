import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";

import { ThemeProvider } from "@/context/ThemeContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

const PUBLIC_ROUTES = [
  "index",
  "login",
  "register",
  "forgot-password",
  "verify-code",
  "reset-password",
];

function RouteGuard() {
  const { token, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const current = segments[0] ?? "index";
    const isPublic = PUBLIC_ROUTES.includes(current);

    if (!token && !isPublic) {
      router.replace("/login");
    }
  }, [token, loading, segments]);

  return null;
}

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemeProvider>
          <RouteGuard />
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
