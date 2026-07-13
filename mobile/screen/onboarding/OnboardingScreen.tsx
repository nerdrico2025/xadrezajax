import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Chessboard from "react-native-chessboard";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { logEvent } from "@/services/analytics";
import { submitOnboarding, type OnboardingAnswers } from "@/services/onboarding";
import {
  DIFFICULTY_BY_LEVEL,
  EXPERIENCE_OPTIONS,
  FREQUENCY_OPTIONS,
  MATE_DIAGRAMS,
  type OnboardingExperience,
  type OnboardingFrequency,
} from "@/constants/onboarding";
import GameScreen from "@/screen/game/GameScreen";
import type { Difficulty } from "@/components/DifficultyModal";

// Onboarding em 3 toques (item 0.4): 3 perguntas, 1 toque cada, zero campos
// de texto. Tocar numa opção já avança — não há botão "avançar" (a meta do
// PRD é <90s do cadastro ao primeiro lance). Ao concluir, a resposta do
// backend define a dificuldade e a partida vs IA começa direto, sem Home.

const STEP_TITLES = [
  "Você já jogou xadrez antes?",
  "Onde as brancas dão mate em 1 lance?",
  "Com que frequência você quer jogar?",
];

export default function OnboardingScreen() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { token, updateUser } = useAuth();
  const { width } = useWindowDimensions();

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<OnboardingAnswers>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [gameDifficulty, setGameDifficulty] = useState<Difficulty | null>(null);

  useEffect(() => {
    logEvent("onboarding_started");
  }, []);

  const finish = useCallback(
    async (complete: OnboardingAnswers) => {
      if (!token) return;
      setSubmitting(true);
      setError(false);
      try {
        const result = await submitOnboarding(token, complete);
        updateUser({ onboarding_completed: true, rating: result.rating });

        if (result.already_completed || !result.level) {
          // Conta já onboardada (ex.: reentrada na rota) — segue para a Home
          router.replace("/home");
          return;
        }

        const difficulty = DIFFICULTY_BY_LEVEL[result.level];
        logEvent("onboarding_completed", {
          level: result.level,
          rating: result.rating,
        });
        logEvent("first_game_started", { difficulty });
        setGameDifficulty(difficulty);
      } catch {
        setError(true);
      } finally {
        setSubmitting(false);
      }
    },
    [token, updateUser]
  );

  const answerExperience = (experience: OnboardingExperience) => {
    setAnswers((prev) => ({ ...prev, experience }));
    setStep(1);
  };

  const answerMate = (foundMate: boolean) => {
    setAnswers((prev) => ({ ...prev, foundMate }));
    setStep(2);
  };

  const answerFrequency = (frequency: OnboardingFrequency) => {
    const complete = { ...answers, frequency } as OnboardingAnswers;
    setAnswers(complete);
    finish(complete);
  };

  // A primeira partida é o feedback do onboarding: vs IA na dificuldade do
  // nível, de brancas e sem relógio (sem pressão de tempo na estreia).
  if (gameDifficulty) {
    return (
      <GameScreen
        difficulty={gameDifficulty}
        playerColor="w"
        timeControl={null}
        onLeave={() => router.replace("/home")}
      />
    );
  }

  const boardSize = Math.min(width - 120, 180);

  const renderOption = (
    key: string,
    label: string,
    icon: string,
    onPress: () => void
  ) => (
    <Pressable
      key={key}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: colors.card,
          borderColor: pressed ? colors.accent : colors.divider,
        },
      ]}
      onPress={onPress}
      disabled={submitting}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon as any} size={22} color={colors.accent} />
      <Text style={[styles.optionLabel, { color: colors.text }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.secondary} />
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Progresso das 3 etapas — dourado (colors.accent) nos concluídos */}
      <View style={styles.progressRow}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.progressDot,
              {
                backgroundColor: i <= step ? colors.accent : colors.divider,
                width: i === step ? 28 : 10,
              },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.stepLabel, { color: colors.secondary }]}>
        {step + 1} de 3
      </Text>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.text }]}>
          {STEP_TITLES[step]}
        </Text>

        {step === 0 &&
          EXPERIENCE_OPTIONS.map((option) =>
            renderOption(option.value, option.label, option.icon, () =>
              answerExperience(option.value)
            )
          )}

        {step === 1 &&
          MATE_DIAGRAMS.map((diagram, index) => (
            <Pressable
              key={diagram.fen}
              style={({ pressed }) => [
                styles.diagramCard,
                {
                  backgroundColor: colors.card,
                  borderColor: pressed ? colors.accent : colors.divider,
                },
              ]}
              onPress={() => answerMate(diagram.isMate)}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={`Diagrama ${index + 1}`}
            >
              {/* pointerEvents none: o toque é do card, não do tabuleiro */}
              <View pointerEvents="none">
                <Chessboard
                  fen={diagram.fen}
                  gestureEnabled={false}
                  boardSize={boardSize}
                  withLetters={false}
                  withNumbers={false}
                />
              </View>
              <Text style={[styles.diagramLabel, { color: colors.secondary }]}>
                Diagrama {index + 1}
              </Text>
            </Pressable>
          ))}

        {step === 2 &&
          FREQUENCY_OPTIONS.map((option) =>
            renderOption(option.value, option.label, option.icon, () =>
              answerFrequency(option.value)
            )
          )}

        {submitting && (
          <View style={styles.feedbackRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.feedbackText, { color: colors.secondary }]}>
              Preparando sua primeira partida...
            </Text>
          </View>
        )}

        {error && !submitting && (
          <Pressable
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={() => finish(answers as OnboardingAnswers)}
            accessibilityRole="button"
            accessibilityLabel="Tentar novamente"
          >
            <Text style={[styles.retryText, { color: colors.accentText }]}>
              Tentar novamente
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 64 },
  progressRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  progressDot: { height: 10, borderRadius: 5 },
  stepLabel: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
  },
  content: { padding: 24, paddingBottom: 48 },
  title: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 24,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  optionLabel: { flex: 1, fontSize: 16, fontWeight: "600" },
  diagramCard: {
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  diagramLabel: { marginTop: 8, fontSize: 13, fontWeight: "600" },
  feedbackRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 12,
  },
  feedbackText: { fontSize: 14, fontWeight: "600" },
  retryButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  retryText: { fontSize: 15, fontWeight: "700" },
});
