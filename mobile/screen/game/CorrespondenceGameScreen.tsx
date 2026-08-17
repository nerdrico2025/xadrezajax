import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Chessboard from "react-native-chessboard";
import type { ChessboardRef } from "react-native-chessboard";
import { Ionicons } from "@expo/vector-icons";

import { makeRenderPiece } from "@/constants/pieceSet";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useBoardTheme } from "@/context/BoardThemeContext";
import { PROMOTION_LABELS, toChessboardColors } from "@/constants/boardThemes";
import {
  getCorrespondenceGame,
  submitCorrespondenceMove,
  CorrespondenceApiError,
  type CorrespondenceGame,
} from "@/services/correspondence";
import { formatDeadline } from "@/utils/correspondenceTime";
import type { GameResult } from "./GameOverModal";
import GameOverModal from "./GameOverModal";

interface Props {
  game: CorrespondenceGame;
  onBack: () => void;
  onUpgrade?: () => void;
}

export default function CorrespondenceGameScreen({ game: initialGame, onBack, onUpgrade }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { theme: boardTheme } = useBoardTheme();
  const boardColors = toChessboardColors(boardTheme);
  const { token } = useAuth();

  const [game, setGame] = useState(initialGame);
  const [boardSize, setBoardSize] = useState(0);
  const [movePending, setMovePending] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const chessboardRef = useRef<ChessboardRef>(null);

  const isFlipped = game.my_color === "b";
  const isMyTurn = game.status === "active" && !!game.is_my_turn && !movePending;

  const measureBoard = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const side = Math.floor(Math.min(width, height) / 8) * 8;
    setBoardSize((prev) => (prev === side ? prev : side));
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const updated = await getCorrespondenceGame(token, game.id);
      setGame(updated);
    } catch {
      // Refresh manual é best-effort — o estado local continua o último
      // conhecido, e o usuário pode tentar de novo.
    } finally {
      setRefreshing(false);
    }
  }, [token, game.id]);

  const onMove = useCallback(
    async (data: any) => {
      const { move } = data;
      if (!move || !isMyTurn || !token) return;

      const isPromotion = move.piece === "p" && (move.to[1] === "8" || move.to[1] === "1");
      const uci = `${move.from}${move.to}${move.promotion ?? (isPromotion ? "q" : "")}`;

      setMovePending(true);
      setMoveError(null);
      try {
        const updated = await submitCorrespondenceMove(token, game.id, uci);
        setGame(updated);
      } catch (e) {
        // Lance recusado pelo servidor (desincronia, dessincronia de turno):
        // volta o tabuleiro pro FEN autoritativo em vez de deixá-lo num
        // estado que o servidor nunca aceitou.
        chessboardRef.current?.resetBoard(game.fen);
        setMoveError(
          e instanceof CorrespondenceApiError ? e.message : "Não foi possível enviar o lance."
        );
      } finally {
        setMovePending(false);
      }
    },
    [isMyTurn, token, game.id, game.fen]
  );

  useEffect(() => {
    if (!moveError) return;
    const id = setTimeout(() => setMoveError(null), 5000);
    return () => clearTimeout(id);
  }, [moveError]);

  const opponentName = game.opponent.username ?? game.opponent.full_name;

  let gameResult: GameResult | null = null;
  if (game.status === "finished") {
    const reason = (game.termination || "checkmate") as GameResult["reason"];
    if (game.result === "draw") {
      gameResult = { outcome: "draw", reason };
    } else {
      const won = game.result === (game.my_color === "w" ? "white" : "black");
      gameResult = { outcome: won ? "win" : "loss", reason };
    }
  }

  const waitingLabel =
    game.status === "finished"
      ? null
      : movePending
      ? "Enviando lance..."
      : !game.is_my_turn
      ? `Aguardando ${opponentName} — ${formatDeadline(game.current_deadline)}`
      : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.opponentName, { color: colors.text }]} numberOfLines={1}>
            {opponentName}
          </Text>
          {game.status === "active" ? (
            <Text style={[styles.deadline, { color: colors.secondary }]}>
              {formatDeadline(game.current_deadline)}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={refresh}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Atualizar partida"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.secondary} />
          ) : (
            <Ionicons name="refresh" size={22} color={colors.secondary} />
          )}
        </Pressable>
      </View>

      {waitingLabel ? (
        <View
          style={[styles.waitingBanner, { backgroundColor: colors.accentMuted, borderColor: colors.accent + "55" }]}
          accessibilityRole="alert"
        >
          <Ionicons name="hourglass-outline" size={16} color={colors.accentOnLight} />
          <Text style={[styles.waitingText, { color: colors.text }]}>{waitingLabel}</Text>
        </View>
      ) : null}

      {moveError ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.accentMuted, borderColor: colors.error + "55" }]}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.text }]}>{moveError}</Text>
        </View>
      ) : null}

      <View style={styles.boardBox} onLayout={measureBoard}>
        {boardSize > 0 && (
          <View
            key={`${game.id}-${game.my_color}-${boardSize}`}
            style={[
              styles.boardWrapper,
              { width: boardSize, height: boardSize },
              isFlipped && styles.boardFlipped,
              { pointerEvents: isMyTurn ? "auto" : "none" },
            ]}
          >
            <Chessboard
              ref={chessboardRef}
              fen={game.fen}
              boardSize={boardSize}
              onMove={onMove}
              colors={boardColors}
              flipped={isFlipped}
              promotionLabels={PROMOTION_LABELS}
              withLetters={!isFlipped}
              withNumbers={!isFlipped}
              renderPiece={makeRenderPiece(boardSize, isFlipped)}
            />
          </View>
        )}
      </View>

      <GameOverModal
        result={gameResult}
        mode="online"
        ratingOutcome={null}
        onNewGame={onBack}
        onLeave={onBack}
        playerColor={game.my_color ?? "w"}
        onUpgrade={onUpgrade}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, alignItems: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  opponentName: { fontSize: 15, fontWeight: "700" },
  deadline: { fontSize: 12, marginTop: 2 },
  waitingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 16,
    marginBottom: 0,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  waitingText: { fontSize: 13, flexShrink: 1 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    margin: 16,
    marginBottom: 0,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: { fontSize: 13, flexShrink: 1, lineHeight: 18 },
  boardBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  boardWrapper: {},
  boardFlipped: { transform: [{ rotate: "180deg" }] },
});
