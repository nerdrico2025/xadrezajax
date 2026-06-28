import { StyleSheet, Text, View } from "react-native";
import type { ClockColor } from "@/hooks/useChessClock";

interface Props {
  whiteMs: number | null;
  blackMs: number | null;
  active: ClockColor | null;
  myColor: ClockColor;
  colors: any;
}

function formatMs(ms: number | null): string {
  if (ms === null) return "∞";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ChessClock({ whiteMs, blackMs, active, myColor, colors }: Props) {
  if (whiteMs === null && blackMs === null) return null;
  if (active === null) return null;

  const ms = active === "w" ? whiteMs : blackMs;
  const isMyTurn = active === myColor;
  const isLow = ms !== null && ms < 30000;

  return (
    <View style={[styles.container, {
      borderColor: isLow ? colors.error : colors.primary + "80",
      backgroundColor: isLow ? colors.error + "15" : colors.primary + "15",
    }]}>
      <Text style={[styles.label, { color: isLow ? colors.error : colors.secondary }]}>
        {isMyTurn ? "Você" : "Oponente"}
      </Text>
      <Text style={[styles.time, { color: isLow ? colors.error : colors.text }]}>
        {formatMs(ms)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 80,
  },
  label: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 1,
  },
  time: {
    fontSize: 20,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
