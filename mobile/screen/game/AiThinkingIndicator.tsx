import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

// Indicador não-bloqueante "Pensando" para a jogada da IA (PR D, item 8).
// Fica na área do oponente, NUNCA sobre o tabuleiro. Dourado AJAX sinaliza
// atividade sem alarmar.
interface Props {
  color: string; // colors.accent (dourado)
  textColor: string;
}

export default function AiThinkingIndicator({ color, textColor }: Props) {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 320, useNativeDriver: true }),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dots]);

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel="A IA está pensando">
      <Text style={[styles.label, { color: textColor }]}>Pensando</Text>
      <View style={styles.dots}>
        {dots.map((d, i) => (
          <Animated.View
            key={i}
            style={[styles.dot, { backgroundColor: color, opacity: d }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 14, fontWeight: "600" },
  dots: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
