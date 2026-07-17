import { useMemo, useState } from "react";
import {
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

  const level = AI_LEVEL_BY_ID[difficulty];
  const time = AI_TIME_BY_ID[timeId];

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

  const handlePrimary = () => {
    if (step < 3) {
      setStep((s) => (s + 1) as 1 | 2 | 3);
      return;
    }
    const playerColor: PlayerColor =
      color === "random" ? (Math.random() < 0.5 ? "w" : "b") : color;
    onStart({ difficulty, playerColor, color, timeControl: time });
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

        {/* Passo 1 — Dificuldade */}
        {step === 1 &&
          AI_LEVELS.map((l) => {
            const selected = difficulty === l.id;
            return (
              <Pressable
                key={l.id}
                onPress={() => setDifficulty(l.id)}
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
                accessibilityLabel={`${l.label}, aproximadamente ${l.elo} de rating`}
              >
                <Ionicons name={l.icon as any} size={26} color={selected ? colors.accent : l.color} />
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, { color: colors.text }]}>
                    {l.label} <Text style={{ color: colors.secondary }}>· ~{l.elo}</Text>
                  </Text>
                  <Text style={[styles.optionSub, { color: colors.secondary }]}>{l.description}</Text>
                </View>
                {selected && <Ionicons name="checkmark-circle" size={22} color={colors.accent} />}
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
          style={[styles.cta, { backgroundColor: colors.accent }]}
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
