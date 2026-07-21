import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useCampaignProgress } from "@/hooks/useCampaignProgress";
import { QA_UNLOCK_ALL_AI_LEVELS } from "@/constants/qaFlags";
import {
  currentCampaignLevel,
  resolvePreselectedLevel,
} from "@/utils/campaignHelpers";
import {
  AI_LEVELS,
  AI_LEVEL_BY_ID,
  AI_TIME_CONTROLS,
  AI_TIME_BY_ID,
  AI_TIME_GROUP_ORDER,
  type AiTimeControl,
  type ColorChoice,
  type Difficulty,
  type PlayerColor,
} from "@/constants/aiGame";
import type { AiSetupPrefs } from "@/utils/aiSetupPrefs";

interface StartConfig {
  difficulty: Difficulty;
  /** Cor resolvida para o jogo (aleatório já sorteado). */
  playerColor: PlayerColor;
  /** Escolha crua do usuário — persistida para pré-selecionar depois. */
  color: ColorChoice;
  timeControl: AiTimeControl;
}

interface Props {
  initial?: AiSetupPrefs | null;
  onStart: (config: StartConfig) => void;
  onBack: () => void;
}

const COLOR_OPTIONS: { id: ColorChoice; label: string; sub: string; icon: string }[] = [
  { id: "w", label: "Brancas", sub: "Você começa", icon: "ellipse-outline" },
  { id: "b", label: "Pretas", sub: "A IA começa", icon: "ellipse" },
  { id: "random", label: "Aleatório", sub: "Sorteia ao iniciar", icon: "shuffle" },
];

const COLOR_LABEL: Record<ColorChoice, string> = {
  w: "Brancas",
  b: "Pretas",
  random: "Aleatório",
};

const STEP_TITLES = ["Dificuldade", "Cor das peças", "Controle de tempo"];

export default function AiGameSetupScreen({ initial, onStart, onBack }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [difficulty, setDifficulty] = useState<Difficulty>(
    initial?.difficulty ?? "medium"
  );
  const [color, setColor] = useState<ColorChoice>(initial?.color ?? "w");
  const [timeId, setTimeId] = useState<string>(
    initial && AI_TIME_BY_ID[initial.timeId] ? initial.timeId : "blitz_5_0"
  );

  // Modo Campanha: níveis travados viram cadeado no passo 1. Erro sempre
  // visível (regra do PR #77) — nunca engolir em silêncio.
  const {
    progress: campaign,
    loading: campaignLoading,
    error: campaignError,
    refresh: refreshCampaign,
  } = useCampaignProgress();

  // Corrige a pré-seleção quando o progresso chega: mantém a última config
  // usada (PR C) só se ainda estiver desbloqueada; senão cai no nível
  // desbloqueado mais alto. Só roda uma vez, na primeira chegada dos dados —
  // não deve sobrescrever uma escolha manual do usuário depois.
  const didResolveInitialDifficulty = useRef(false);
  useEffect(() => {
    if (!campaign || didResolveInitialDifficulty.current) return;
    didResolveInitialDifficulty.current = true;
    setDifficulty((current) => resolvePreselectedLevel(current, campaign));
  }, [campaign]);

  const level = AI_LEVEL_BY_ID[difficulty];
  const time = AI_TIME_BY_ID[timeId];
  const activeCampaignLevel = campaign ? currentCampaignLevel(campaign) : null;

  const summary = useMemo(
    () =>
      `${level.label} · ~${level.elo}  ·  ${COLOR_LABEL[color]}  ·  ${
        time.base === null ? "Sem limite" : time.label
      }`,
    [level, color, time]
  );

  const goBack = () => {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3);
    else onBack();
  };

  // Enquanto o progresso da campanha não chegou (ou falhou), não dá pra
  // confiar no cadeado exibido — trava o avanço do passo 1 até resolver.
  const campaignBlocking =
    step === 1 && (campaignLoading || (!!campaignError && !campaign));

  const handlePrimary = () => {
    if (campaignBlocking) return;
    if (step < 3) {
      setStep((s) => (s + 1) as 1 | 2 | 3);
      return;
    }
    const playerColor: PlayerColor =
      color === "random" ? (Math.random() < 0.5 ? "w" : "b") : color;
    onStart({ difficulty, playerColor, color, timeControl: time });
  };

  const handleLockedLevelPress = (l: (typeof AI_LEVELS)[number], index: number) => {
    const previous = AI_LEVELS[index - 1];
    const wins =
      campaign?.find((p) => p.nivel === previous?.id)?.vitorias_para_desbloquear ?? 3;
    Alert.alert(
      "Nível bloqueado",
      previous
        ? `Vença ${wins} partidas no nível ${previous.label} para desbloquear ${l.label}.`
        : `Vença partidas no nível anterior para desbloquear ${l.label}.`
    );
  };

  const timeGroups = useMemo(
    () =>
      AI_TIME_GROUP_ORDER.map((group) => ({
        group,
        options: AI_TIME_CONTROLS.filter((t) => t.group === group),
      })),
    []
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header + indicador de passo */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.divider }]}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Jogar contra a IA</Text>
        <View style={{ width: 42 }} />
      </View>

      <View style={styles.stepRow}>
        {[1, 2, 3].map((s) => (
          <View key={s} style={styles.stepItem}>
            <View
              style={[
                styles.stepDot,
                {
                  backgroundColor: s <= step ? colors.accent : "transparent",
                  borderColor: s <= step ? colors.accent : colors.divider,
                },
              ]}
            >
              <Text style={[styles.stepDotText, { color: s <= step ? colors.accentText : colors.secondary }]}>
                {s}
              </Text>
            </View>
            {s < 3 && (
              <View style={[styles.stepBar, { backgroundColor: s < step ? colors.accent : colors.divider }]} />
            )}
          </View>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.stepTitle, { color: colors.text }]}>
          {step}. {STEP_TITLES[step - 1]}
        </Text>

        {/* Passo 1 — Dificuldade (Modo Campanha: cadeado + progresso) */}
        {step === 1 && campaignLoading && (
          <View style={styles.campaignStatus}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={[styles.campaignStatusText, { color: colors.secondary }]}>
              Carregando progresso da campanha...
            </Text>
          </View>
        )}

        {step === 1 && !campaignLoading && campaignError && !campaign && (
          <View style={styles.campaignStatus}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.secondary} />
            <Text style={[styles.campaignStatusText, { color: colors.text }]}>
              {campaignError}
            </Text>
            <Pressable
              onPress={refreshCampaign}
              style={[styles.retryButton, { backgroundColor: colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel="Tentar novamente"
            >
              <Text style={[styles.retryButtonText, { color: colors.accentText }]}>
                Tentar novamente
              </Text>
            </Pressable>
          </View>
        )}

        {step === 1 &&
          !campaignLoading &&
          (campaign || !campaignError) &&
          AI_LEVELS.map((l, index) => {
            const selected = difficulty === l.id;
            const progressRow = campaign?.find((p) => p.nivel === l.id);
            // Flag de QA (só fora de produção): destrava a seleção para
            // permitir testar a calibragem dos 5 níveis em device sem ter
            // de vencer a campanha antes. Não altera o progresso real.
            const locked = QA_UNLOCK_ALL_AI_LEVELS
              ? false
              : progressRow
                ? !progressRow.desbloqueado
                : false;
            const isActiveLevel = activeCampaignLevel === l.id;

            return (
              <Pressable
                key={l.id}
                onPress={() =>
                  locked ? handleLockedLevelPress(l, index) : setDifficulty(l.id)
                }
                style={[
                  styles.optionCard,
                  {
                    borderColor: selected ? colors.accent : colors.divider,
                    backgroundColor: selected ? colors.accent + "18" : colors.card,
                    borderWidth: selected ? 2 : 1,
                    opacity: locked ? 0.5 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: locked }}
                accessibilityLabel={
                  locked
                    ? `${l.label}, travado`
                    : `${l.label}, aproximadamente ${l.elo} de rating`
                }
              >
                <Ionicons
                  name={(locked ? "lock-closed" : l.icon) as any}
                  size={26}
                  color={locked ? colors.secondary : selected ? colors.accent : l.color}
                />
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, { color: colors.text }]}>
                    {l.label} <Text style={{ color: colors.secondary }}>· ~{l.elo}</Text>
                  </Text>
                  <Text style={[styles.optionSub, { color: colors.secondary }]}>
                    {l.description}
                  </Text>
                  {isActiveLevel && progressRow && (
                    <View style={styles.campaignProgress}>
                      <View
                        style={[
                          styles.campaignProgressTrack,
                          { backgroundColor: colors.divider },
                        ]}
                      >
                        <View
                          style={[
                            styles.campaignProgressFill,
                            {
                              backgroundColor: colors.accent,
                              width: `${Math.min(
                                100,
                                (progressRow.vitorias /
                                  progressRow.vitorias_para_desbloquear) *
                                  100
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[styles.campaignProgressText, { color: colors.accent }]}
                      >
                        {progressRow.vitorias}/{progressRow.vitorias_para_desbloquear}{" "}
                        vitórias
                      </Text>
                    </View>
                  )}
                </View>
                {locked ? (
                  <Ionicons name="lock-closed" size={18} color={colors.secondary} />
                ) : (
                  selected && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                  )
                )}
              </Pressable>
            );
          })}

        {/* Passo 2 — Cor */}
        {step === 2 &&
          COLOR_OPTIONS.map((c) => {
            const selected = color === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setColor(c.id)}
                style={[
                  styles.optionCard,
                  {
                    borderColor: selected ? colors.accent : colors.divider,
                    backgroundColor: selected ? colors.accent + "18" : colors.card,
                    borderWidth: selected ? 2 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={c.label}
              >
                <Ionicons name={c.icon as any} size={24} color={selected ? colors.accent : colors.text} />
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, { color: colors.text }]}>{c.label}</Text>
                  <Text style={[styles.optionSub, { color: colors.secondary }]}>{c.sub}</Text>
                </View>
                {selected && <Ionicons name="checkmark-circle" size={22} color={colors.accent} />}
              </Pressable>
            );
          })}

        {/* Passo 3 — Controle de tempo */}
        {step === 3 &&
          timeGroups.map(({ group, options }) => (
            <View key={group} style={styles.timeGroup}>
              <Text style={[styles.groupLabel, { color: colors.secondary }]}>{group}</Text>
              <View style={styles.chips}>
                {options.map((t) => {
                  const selected = timeId === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setTimeId(t.id)}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? colors.accent : colors.divider,
                          backgroundColor: selected ? colors.accent + "22" : colors.card,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${group} ${t.label}`}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: selected ? colors.accent : colors.text, fontWeight: selected ? "800" : "600" },
                        ]}
                      >
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

        {step === 3 && time.base === null && (
          <Text style={[styles.note, { color: colors.secondary }]}>
            Partidas sem limite de tempo não valem rating.
          </Text>
        )}
      </ScrollView>

      {/* Rodapé fixo: resumo + CTA. O jogo só começa ao tocar "Iniciar partida". */}
      <View style={[styles.footer, { borderTopColor: colors.divider, paddingBottom: insets.bottom + 12 }]}>
        <Text style={[styles.summary, { color: colors.secondary }]} numberOfLines={1}>
          {summary}
        </Text>
        <Pressable
          onPress={handlePrimary}
          disabled={campaignBlocking}
          style={[
            styles.cta,
            { backgroundColor: colors.accent, opacity: campaignBlocking ? 0.5 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={step < 3 ? "Continuar" : "Iniciar partida"}
        >
          <Text style={[styles.ctaText, { color: colors.accentText }]}>
            {step < 3 ? "Continuar" : "Iniciar partida"}
          </Text>
        </Pressable>
      </View>
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

  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16 },
  stepItem: { flexDirection: "row", alignItems: "center" },
  stepDot: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  stepDotText: { fontSize: 13, fontWeight: "800" },
  stepBar: { width: 40, height: 2, marginHorizontal: 4 },

  stepTitle: { fontSize: 20, fontWeight: "800", marginBottom: 16 },

  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    minHeight: 64,
  },
  optionText: { flex: 1 },
  optionLabel: { fontSize: 16, fontWeight: "700" },
  optionSub: { fontSize: 13, marginTop: 2 },

  campaignStatus: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 32,
  },
  campaignStatusText: { fontSize: 14, textAlign: "center" },
  retryButton: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  retryButtonText: { fontSize: 14, fontWeight: "600" },

  campaignProgress: { marginTop: 8, gap: 4 },
  campaignProgressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  campaignProgressFill: {
    height: "100%",
    borderRadius: 3,
  },
  campaignProgressText: { fontSize: 12, fontWeight: "700" },

  timeGroup: { marginBottom: 18 },
  groupLabel: {
    fontSize: 12, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 0.8, marginBottom: 10,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    minWidth: 64, minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontSize: 15 },
  note: { fontSize: 13, marginTop: 4, textAlign: "center" },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  summary: { fontSize: 13, textAlign: "center", fontWeight: "600" },
  cta: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaText: { fontSize: 16, fontWeight: "800" },
});
