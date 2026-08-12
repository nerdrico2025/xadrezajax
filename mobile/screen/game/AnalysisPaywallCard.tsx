import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors } from "@/constants/theme";

/**
 * Convite a assinar, no lugar do silêncio que havia para quem não paga.
 *
 * Extraído do GameAnalysisSection para ter DOIS pontos de uso — a tela de fim
 * de partida e o detalhe do histórico. É a mesma promessa nos dois lugares, e
 * duplicar a copy garantiria que um dia elas divergissem.
 *
 * Diz o que a análise MOSTRA, não só que ela é paga: quem acabou de perder uma
 * partida (ou está revendo onde errou) tem interesse genuíno em saber, e é o
 * momento em que a promessa é concreta. Mesmo registro do bloqueio do Treino
 * (PuzzleScreen), para o produto falar de um jeito só.
 */

type ThemeColors = (typeof Colors)[keyof typeof Colors];

export function AnalysisCard({
  colors,
  children,
}: {
  colors: ThemeColors;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { borderColor: colors.buttonSecondary }]}>
      {children}
    </View>
  );
}

export default function AnalysisPaywallCard({
  colors,
  onUpgrade,
  /** Sem cartão em volta: no detalhe do histórico o bloqueio é a tela
   *  inteira, não uma caixa dentro dela. */
  bare = false,
}: {
  colors: ThemeColors;
  onUpgrade?: () => void;
  bare?: boolean;
}) {
  const content = (
    <>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>
          Análise da partida
        </Text>
        {/* Sem cadeado no modo `bare`: lá o bloqueio é a tela inteira e já
            tem um cadeado grande acima — dois seria eco. */}
        {bare ? null : (
          <Ionicons name="lock-closed" size={16} color={colors.secondary} />
        )}
      </View>
      <Text style={[styles.status, { color: colors.secondary }]}>
        Veja sua precisão, os erros e o lance que decidiu a partida — lance a
        lance. É exclusivo do Premium.
      </Text>
      {onUpgrade ? (
        <Pressable
          onPress={onUpgrade}
          style={styles.toggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Assinar o Premium para ver a análise da partida"
        >
          <Ionicons name="star" size={16} color={colors.accent} />
          <Text style={[styles.toggleText, { color: colors.accent }]}>
            Assinar Premium
          </Text>
        </Pressable>
      ) : null}
    </>
  );

  if (bare) return <View style={styles.bare}>{content}</View>;
  return <AnalysisCard colors={colors}>{content}</AnalysisCard>;
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  bare: { width: "100%", gap: 8 },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  title: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  status: { fontSize: 13, flexShrink: 1 },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 2,
  },
  toggleText: { fontSize: 13, fontWeight: "600" },
});
