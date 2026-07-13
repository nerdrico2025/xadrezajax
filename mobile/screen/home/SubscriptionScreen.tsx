import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  createCheckoutSession,
  getSubscription,
  type PaidPlan,
  type SubscriptionState,
} from "@/services/payments";

interface Props {
  onBack: () => void;
}

const FEATURES = [
  { icon: "infinite-outline",     label: "Partidas ilimitadas",          sub: "Sem o limite de 5 partidas por dia" },
  { icon: "trophy-outline",       label: "Torneios exclusivos",          sub: "Participe de competições mensais" },
  { icon: "analytics-outline",    label: "Análise avançada de partidas", sub: "Revisão completa com sugestões" },
  { icon: "color-palette-outline",label: "Temas e peças premium",        sub: "Personalize o tabuleiro" },
  { icon: "shield-checkmark-outline", label: "Sem anúncios",             sub: "Experiência limpa" },
];

// Preços do PRD (Mensal R$ 39,90 · Anual R$ 359 ≈ R$ 29,92/mês, 25% off)
const PLAN_INFO: Record<PaidPlan, { name: string; price: string; note: string }> = {
  annual: { name: "Anual", price: "R$ 29,92", note: "Cobrado anualmente — R$ 359,00" },
  monthly: { name: "Mensal", price: "R$ 39,90", note: "Cobrado mensalmente" },
};

// Retorno do Checkout: o backend redireciona para este deep link (scheme
// "ajax" do app.json) e o openAuthSessionAsync fecha o navegador.
const RETURN_DEEP_LINK = "ajax://subscription-return";

export default function SubscriptionScreen({ onBack }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PaidPlan>("annual");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshSubscription = useCallback(async () => {
    if (!token) return null;
    try {
      const state = await getSubscription(token);
      setSubscription(state);
      return state;
    } catch {
      return null;
    }
  }, [token]);

  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription]);

  const isPaid =
    subscription?.status === "active" || subscription?.status === "trialing";

  const handleSubscribe = async () => {
    if (!token || checkoutLoading) return;
    setError("");
    setCheckoutLoading(true);
    try {
      const { checkout_url } = await createCheckoutSession(token, selectedPlan);
      // Navegador de sistema via openAuthSessionAsync: abordagem mais
      // simples de manter — sem WebView própria para PCI/3DS, e o retorno
      // ao deep link fecha o navegador sozinho (distribuição via APK
      // direto, sem restrição de loja).
      await WebBrowser.openAuthSessionAsync(checkout_url, RETURN_DEEP_LINK);
      // Voltou do checkout (pago OU cancelado): reconsulta o backend.
      // Cancelamento não é erro — a tela só continua mostrando os planos.
      const state = await refreshSubscription();
      const nowPaid =
        state?.status === "active" || state?.status === "trialing";
      if (!nowPaid) {
        // O webhook pode levar alguns segundos — tenta mais uma vez.
        setTimeout(refreshSubscription, 3000);
      }
    } catch (e: any) {
      setError(e?.message ?? "Não foi possível abrir o checkout.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const formatDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : null;

  const renderActivePlan = () => {
    if (!subscription || !isPaid) return null;
    const planName =
      subscription.plan === "annual" ? "Anual" : "Mensal";
    const trialUntil =
      subscription.status === "trialing" ? formatDate(subscription.trial_end) : null;
    const renewsAt = formatDate(subscription.current_period_end);

    return (
      <View
        style={[
          styles.activeCard,
          { backgroundColor: colors.accent + "18", borderColor: colors.accent + "66" },
        ]}
      >
        {/* Selo de plano pago em dourado (0.6-C) */}
        <View style={[styles.activeBadge, { backgroundColor: colors.accent }]}>
          <Ionicons name="star" size={14} color={colors.accentText} />
          <Text style={[styles.activeBadgeText, { color: colors.accentText }]}>
            Premium ativo
          </Text>
        </View>
        <Text style={[styles.activePlanName, { color: colors.text }]}>
          Plano {planName}
        </Text>
        {trialUntil ? (
          <Text style={[styles.activeDetail, { color: colors.secondary }]}>
            Período de teste grátis até {trialUntil}
          </Text>
        ) : renewsAt ? (
          <Text style={[styles.activeDetail, { color: colors.secondary }]}>
            Renova em {renewsAt}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderPlanCard = (plan: PaidPlan) => {
    const info = PLAN_INFO[plan];
    const selected = selectedPlan === plan;
    return (
      <Pressable
        key={plan}
        style={[
          styles.planCard,
          {
            backgroundColor: colors.card,
            borderColor: selected ? colors.accent : colors.divider,
            borderWidth: selected ? 2 : 1,
          },
        ]}
        onPress={() => setSelectedPlan(plan)}
        accessibilityRole="button"
        accessibilityLabel={`Plano ${info.name}`}
        accessibilityState={{ selected }}
      >
        <View style={styles.planTop}>
          <Text style={[styles.planName, { color: colors.text }]}>{info.name}</Text>
          {plan === "annual" && (
            <View style={[styles.planBadge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.planBadgeText, { color: colors.accentText }]}>
                Economize 25%
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Ionicons
            name={selected ? "radio-button-on" : "radio-button-off"}
            size={22}
            color={selected ? colors.accent : colors.secondary}
          />
        </View>
        <Text style={[styles.planPrice, { color: colors.text }]}>
          {info.price}
          <Text style={[styles.planPer, { color: colors.secondary }]}>/mês</Text>
        </Text>
        <Text style={[styles.planBilled, { color: colors.secondary }]}>{info.note}</Text>
      </Pressable>
    );
  };

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
        <View style={[styles.hero, { backgroundColor: colors.accent + "14", borderColor: colors.accent + "44" }]}>
          <Text style={styles.heroIcon}>♔</Text>
          <Text style={[styles.heroTitle, { color: colors.text }]}>Xadrez Ajax Premium</Text>
          <Text style={[styles.heroSub, { color: colors.secondary }]}>
            Leve seu jogo ao próximo nível com recursos exclusivos
          </Text>
        </View>

        {renderActivePlan()}

        {/* Features */}
        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>O que está incluído</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          {FEATURES.map((f, i) => (
            <View key={f.label}>
              <View style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: colors.accent + "20" }]}>
                  <Ionicons name={f.icon as any} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.featureLabel, { color: colors.text }]}>{f.label}</Text>
                  <Text style={[styles.featureSub, { color: colors.secondary }]}>{f.sub}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              </View>
              {i < FEATURES.length - 1 && (
                <View style={[styles.divider, { backgroundColor: colors.divider }]} />
              )}
            </View>
          ))}
        </View>

        {!isPaid && (
          <>
            {/* Plans */}
            <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>Planos</Text>
            {renderPlanCard("annual")}
            {renderPlanCard("monthly")}

            {error ? (
              <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
            ) : null}

            {/* CTA de conversão em dourado (0.6-C) */}
            <Pressable
              style={[styles.ctaBtn, { backgroundColor: colors.accent }]}
              onPress={handleSubscribe}
              disabled={checkoutLoading || subscription === null}
              accessibilityRole="button"
              accessibilityLabel="Assinar com 7 dias grátis"
            >
              {checkoutLoading ? (
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text style={[styles.ctaText, { color: colors.accentText }]}>
                  Assinar — 7 dias grátis
                </Text>
              )}
            </Pressable>

            <Text style={[styles.disclaimer, { color: colors.secondary }]}>
              7 dias de teste grátis, depois a cobrança do plano escolhido.{"\n"}
              Cancele a qualquer momento. Renovação automática.
            </Text>
          </>
        )}
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
    marginBottom: 20,
  },
  heroIcon: { fontSize: 48, marginBottom: 12 },
  heroTitle: { fontSize: 22, fontWeight: "800", marginBottom: 6 },
  heroSub: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  activeCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 20,
    marginBottom: 20,
    alignItems: "flex-start",
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  activeBadgeText: { fontSize: 12, fontWeight: "800" },
  activePlanName: { fontSize: 18, fontWeight: "800" },
  activeDetail: { fontSize: 13, marginTop: 4 },

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

  planCard: { borderRadius: 16, padding: 20, marginBottom: 10 },
  planTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  planName: { fontSize: 16, fontWeight: "700" },
  planBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeText: { fontSize: 11, fontWeight: "700" },
  planPrice: { fontSize: 32, fontWeight: "800" },
  planPer: { fontSize: 16, fontWeight: "400" },
  planBilled: { fontSize: 12, marginTop: 4 },

  error: { fontSize: 13, fontWeight: "600", marginBottom: 10, textAlign: "center" },
  ctaBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  ctaText: { fontSize: 16, fontWeight: "700" },
  disclaimer: { fontSize: 11, textAlign: "center", lineHeight: 16 },
});
