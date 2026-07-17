import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Chessboard from "react-native-chessboard";
import type { ChessboardRef } from "react-native-chessboard";
import { Chess } from "chess.js";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import Button from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { useChessSound } from "@/hooks/useChessSound";
import { parseUciMove } from "@/utils/chessSpecialMoves";
import { logEvent } from "@/services/analytics";
import {
  DailyPuzzleLimitError,
  NoPuzzlesAvailableError,
  difficultyForRating,
  getNextPuzzle,
  getPuzzleStats,
  reportPuzzleProgress,
  type PuzzleData,
  type PuzzleStats,
} from "@/services/puzzles";

type Props = {
  onBack: () => void;
  onUpgrade: () => void;
};

type ScreenState =
  | "loading"
  | "playing"
  | "solved"
  | "limit"
  | "empty"
  | "error";

const CATEGORY_LABELS: Record<string, string> = {
  mate_in_1: "Mate em 1",
  mate_in_2: "Mate em 2",
  fork: "Garfo",
  pin: "Cravada",
  skewer: "Espeto",
  promotion: "Promoção",
  tactic: "Tática",
  endgame: "Final",
};

export default function PuzzleScreen({ onBack, onUpgrade }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { token, user } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const { play } = useChessSound();

  const [state, setState] = useState<ScreenState>("loading");
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [feedback, setFeedback] = useState<"ready" | "wrong" | "progress">(
    "ready"
  );
  const [replying, setReplying] = useState(false);

  const chessboardRef = useRef<ChessboardRef>(null);
  // Posição corrente da linha da solução — fonte de verdade para reverter
  // lances errados (resetBoard) e validar a vez do jogador.
  const gameRef = useRef(new Chess());
  const solutionIndexRef = useRef(0);
  const attemptsRef = useRef(1);

  const playerColor = puzzle ? (new Chess(puzzle.fen).turn() as "w" | "b") : "w";

  const refreshStats = useCallback(async () => {
    if (!token) return null;
    const data = await getPuzzleStats(token);
    setStats(data);
    return data;
  }, [token]);

  const loadPuzzle = useCallback(async () => {
    if (!token) return;
    setState("loading");
    try {
      const currentStats = await refreshStats();
      if (
        currentStats?.remaining_puzzles_today === 0 &&
        currentStats.daily_puzzle_limit !== null
      ) {
        logEvent("paywall_shown", { source: "puzzles" });
        setState("limit");
        return;
      }

      const rating =
        profile?.ratings?.blitz?.rating ?? user?.rating ?? 1500;
      const difficulty = difficultyForRating(rating);
      const next = await getNextPuzzle(token, difficulty);

      gameRef.current = new Chess(next.fen);
      solutionIndexRef.current = 0;
      attemptsRef.current = 1;
      setFeedback("ready");
      setPuzzle(next);
      setState("playing");
      logEvent("puzzle_started", {
        puzzle_id: next.id,
        difficulty: next.difficulty,
        category: next.category,
      });
    } catch (err) {
      if (err instanceof DailyPuzzleLimitError) {
        logEvent("paywall_shown", { source: "puzzles" });
        setState("limit");
      } else if (err instanceof NoPuzzlesAvailableError) {
        // Banco sem conteúdo: estado vazio decente, não tela quebrada.
        setState("empty");
      } else {
        setState("error");
      }
    }
  }, [token, profile, user, refreshStats]);

  useEffect(() => {
    if (profileLoading) return;
    loadPuzzle();
    // Carrega uma única vez quando o rating do perfil fica disponível —
    // recarregar a cada mudança de profile remontaria o puzzle em andamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading]);

  const finishPuzzle = useCallback(async () => {
    if (!token || !puzzle) return;
    play("gameEnd");
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logEvent("puzzle_solved", {
      puzzle_id: puzzle.id,
      attempts: attemptsRef.current,
    });
    try {
      await reportPuzzleProgress(token, puzzle.id, true, attemptsRef.current);
    } catch {
      // Progresso é reconciliável: o próximo stats/ reflete o que o backend
      // aceitou; não bloqueia a celebração local.
    }
    await refreshStats().catch(() => {});
    setState("solved");
  }, [token, puzzle, play, refreshStats]);

  const playOpponentReply = useCallback(async (uci: string) => {
    const parsed = parseUciMove(uci);
    if (!parsed) return;
    setReplying(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const reply = gameRef.current.move({
      from: parsed.from,
      to: parsed.to,
      promotion: parsed.promotion ?? "q",
    });
    if (reply) {
      await chessboardRef.current?.move({
        from: parsed.from as any,
        to: parsed.to as any,
        promotion: reply.promotion as any,
      });
      play(reply.captured ? "capture" : "move");
    }
    setReplying(false);
  }, [play]);

  const onMove = async (data: any) => {
    if (!puzzle || state !== "playing" || replying) return;
    const { move } = data;
    if (!move) return;
    if (gameRef.current.turn() !== playerColor) return;

    const expected = puzzle.solution[solutionIndexRef.current];
    const played = `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase();

    if (played !== expected?.toLowerCase()) {
      // Lance fora da solução: desfaz no tabuleiro e conta a tentativa
      attemptsRef.current += 1;
      setFeedback("wrong");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      chessboardRef.current?.resetBoard(gameRef.current.fen());
      return;
    }

    const applied = gameRef.current.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion ?? "q",
    });
    if (!applied) return;
    play(applied.captured ? "capture" : "move");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    solutionIndexRef.current += 1;
    if (solutionIndexRef.current >= puzzle.solution.length) {
      await finishPuzzle();
      return;
    }

    // Resposta automática do "oponente" (lances ímpares da solução)
    setFeedback("progress");
    const replyUci = puzzle.solution[solutionIndexRef.current];
    solutionIndexRef.current += 1;
    await playOpponentReply(replyUci);

    if (solutionIndexRef.current >= puzzle.solution.length) {
      await finishPuzzle();
    }
  };

  const isFree = stats?.daily_puzzle_limit != null;
  const solvedToday =
    isFree && stats
      ? stats.daily_puzzle_limit! - (stats.remaining_puzzles_today ?? 0)
      : 0;

  const feedbackText = {
    ready:
      playerColor === "w"
        ? "Brancas jogam — encontre o melhor lance"
        : "Pretas jogam — encontre o melhor lance",
    wrong: "Não é esse — tente outro lance",
    progress: "Boa! Continue a sequência",
  }[feedback];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: colors.buttonSecondary }]}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Puzzles</Text>
        <View style={styles.headerRight}>
          {/* Streak em dourado (0.6-D) — número em colors.text (contraste AA) */}
          <View
            style={[
              styles.streakChip,
              { backgroundColor: colors.accent + "22", borderColor: colors.accent + "55" },
            ]}
            accessibilityLabel={`Sequência de ${stats?.streak ?? 0} dias`}
          >
            <Ionicons name="flame" size={14} color={colors.accent} />
            <Text style={[styles.streakText, { color: colors.text }]}>
              {stats?.streak ?? 0}
            </Text>
          </View>
        </View>
      </View>

      {state === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {state === "error" && (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.secondary} />
          <Text style={[styles.messageTitle, { color: colors.text }]}>
            Não foi possível carregar
          </Text>
          <Text style={[styles.messageSub, { color: colors.secondary }]}>
            Verifique sua conexão e tente novamente.
          </Text>
          <Button title="Tentar novamente" onPress={loadPuzzle} />
        </View>
      )}

      {state === "empty" && (
        <View style={styles.center}>
          <Ionicons name="extension-puzzle-outline" size={40} color={colors.secondary} />
          <Text style={[styles.messageTitle, { color: colors.text }]}>
            Puzzles chegando em breve
          </Text>
          <Text style={[styles.messageSub, { color: colors.secondary }]}>
            Estamos preparando novos desafios táticos. Volte logo!
          </Text>
          <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.backLink, { color: colors.secondary }]}>
              Voltar ao início
            </Text>
          </Pressable>
        </View>
      )}

      {state === "limit" && (
        <View style={styles.center}>
          <View
            style={[
              styles.limitBadge,
              { backgroundColor: colors.accent + "22", borderColor: colors.accent + "55" },
            ]}
          >
            <Ionicons name="lock-closed" size={28} color={colors.accent} />
          </View>
          <Text style={[styles.messageTitle, { color: colors.text }]}>
            Você completou os puzzles de hoje!
          </Text>
          <Text style={[styles.messageSub, { color: colors.secondary }]}>
            O plano Grátis inclui {stats?.daily_puzzle_limit ?? 3} puzzles por dia.
            Assine o Premium para treinar sem limites.
          </Text>
          <Button
            title="Assinar Premium"
            variant="accent"
            iconName="star"
            onPress={onUpgrade}
          />
          <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.backLink, { color: colors.secondary }]}>
              Voltar ao início
            </Text>
          </Pressable>
        </View>
      )}

      {(state === "playing" || state === "solved") && puzzle && (
        <View style={styles.body}>
          <View style={styles.puzzleInfo}>
            <Text style={[styles.category, { color: colors.secondary }]}>
              {CATEGORY_LABELS[puzzle.category] ?? "Tática"}
              {isFree ? ` · ${solvedToday}/${stats?.daily_puzzle_limit} hoje` : null}
            </Text>
            <Text style={[styles.feedback, { color: feedback === "wrong" ? colors.error : colors.text }]}>
              {state === "solved" ? "Puzzle resolvido! 🎉" : feedbackText}
            </Text>
          </View>

          <View style={styles.boardSection}>
            <Chessboard
              key={puzzle.id}
              ref={chessboardRef}
              fen={puzzle.fen}
              onMove={onMove}
              gestureEnabled={state === "playing" && !replying}
            />
          </View>

          {state === "solved" ? (
            <View style={styles.footer}>
              {/* Streak destacado em dourado no momento de recompensa (0.6-D) */}
              <View
                style={[
                  styles.solvedStreak,
                  { backgroundColor: colors.accent + "22", borderColor: colors.accent + "55" },
                ]}
              >
                <Ionicons name="flame" size={18} color={colors.accent} />
                <Text style={[styles.solvedStreakText, { color: colors.text }]}>
                  {stats?.streak === 1
                    ? "1 dia de sequência"
                    : `${stats?.streak ?? 0} dias de sequência`}
                </Text>
              </View>
              <Button
                title="Próximo puzzle"
                iconName="arrow-forward"
                onPress={loadPuzzle}
              />
            </View>
          ) : (
            <View style={styles.footer}>
              {replying && <ActivityIndicator size="small" color={colors.secondary} />}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
  },
  streakText: { fontSize: 13, fontWeight: "800" },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  messageTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },
  messageSub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  limitBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backLink: { fontSize: 14, fontWeight: "600", padding: 8 },

  body: { flex: 1 },
  puzzleInfo: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    alignItems: "center",
    gap: 4,
  },
  category: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  feedback: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  boardSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    minHeight: 96,
    justifyContent: "flex-end",
    gap: 4,
  },
  solvedStreak: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  solvedStreakText: { fontSize: 14, fontWeight: "700" },
});
