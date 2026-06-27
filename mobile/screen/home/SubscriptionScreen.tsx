import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

interface Props {
  onBack: () => void;
}

const FEATURES = [
  { icon: "trophy-outline",       label: "Torneios exclusivos",        sub: "Participe de competições mensais" },
  { icon: "analytics-outline",    label: "Análise avançada de partidas", sub: "Revisão completa com sugestões" },
  { icon: "color-palette-outline",label: "Temas e peças premium",       sub: "Personalize o tabuleiro" },
{ icon: "people-outline",       label: "Salas privadas ilimitadas",    sub: "Crie quantas salas quiser" },
  { icon: "shield-checkmark-outline", label: "Sem anúncios",            sub: "Experiência limpa" },
];

export default function SubscriptionScreen({ onBack }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.divider }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Premium</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "33" }]}>
          <Text style={styles.heroIcon}>♔</Text>
          <Text style={[styles.heroTitle, { color: colors.primary }]}>Xadrez Ajax Premium</Text>
          <Text style={[styles.heroSub, { color: colors.secondary }]}>
            Leve seu jogo ao próximo nível com recursos exclusivos
          </Text>
        </View>

        {/* Features */}
        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>O que está incluído</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          {FEATURES.map((f, i) => (
            <View key={f.label}>
              <View style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name={f.icon as any} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.featureLabel, { color: colors.text }]}>{f.label}</Text>
                  <Text style={[styles.featureSub, { color: colors.secondary }]}>{f.sub}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              </View>
              {i < FEATURES.length - 1 && (
                <View style={[styles.divider, { backgroundColor: colors.divider }]} />
              )}
            </View>
          ))}
        </View>

        {/* Plans */}
        <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>Planos</Text>

        <View style={[styles.planCard, { backgroundColor: colors.primary, shadowColor: colors.primary }]}>
          <View style={styles.planTop}>
            <Text style={styles.planName}>Anual</Text>
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>Economize 40%</Text>
            </View>
          </View>
          <Text style={styles.planPrice}>R$ 9,90<Text style={styles.planPer}>/mês</Text></Text>
          <Text style={styles.planBilled}>Cobrado anualmente — R$ 118,80</Text>
        </View>

        <View style={[styles.planCardSecondary, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          <Text style={[styles.planName, { color: colors.text }]}>Mensal</Text>
          <Text style={[styles.planPrice, { color: colors.text }]}>R$ 16,90<Text style={[styles.planPer, { color: colors.secondary }]}>/mês</Text></Text>
        </View>

        {/* CTA */}
        <Pressable style={[styles.ctaBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.ctaText}>Em breve</Text>
        </Pressable>

        <Text style={[styles.disclaimer, { color: colors.secondary }]}>
          Cancele a qualquer momento. Assinatura renovada automaticamente.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 8 },
  title: { fontSize: 17, fontWeight: "700" },

  hero: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    marginBottom: 28,
  },
  heroIcon: { fontSize: 48, marginBottom: 12 },
  heroTitle: { fontSize: 22, fontWeight: "800", marginBottom: 6 },
  heroSub: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  sectionLabel: {
    fontSize: 11, fontWeight: "700", letterSpacing: 1,
    textTransform: "uppercase", marginBottom: 10,
  },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  featureIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureLabel: { fontSize: 14, fontWeight: "600" },
  featureSub: { fontSize: 12, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 62 },

  planCard: {
    borderRadius: 16, padding: 20, marginBottom: 10,
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8,
  },
  planCardSecondary: { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 24 },
  planTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  planName: { fontSize: 16, fontWeight: "700", color: "#fff" },
  planBadge: { backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  planPrice: { fontSize: 32, fontWeight: "800", color: "#fff" },
  planPer: { fontSize: 16, fontWeight: "400" },
  planBilled: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 4 },

  ctaBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 16 },
  ctaText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  disclaimer: { fontSize: 11, textAlign: "center", lineHeight: 16 },
});
