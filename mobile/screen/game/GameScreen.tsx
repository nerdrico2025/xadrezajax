import { View, StyleSheet, Alert, ActivityIndicator, Pressable, Image } from "react-native";
import { useRef, useState, useEffect, useCallback } from "react";
import Chessboard from "react-native-chessboard";
import type { ChessboardRef } from "react-native-chessboard";
// @ts-ignore – internal import to access piece images for custom renderPiece
import { PIECES } from "react-native-chessboard/lib/commonjs/constants";
import { Chess } from "chess.js";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { getBestMove } from "@/services/game";
import { parseUciMove } from "@/utils/chessSpecialMoves";
import { reportAiResult } from "@/services/profile";
import { saveGame, clearSavedGame, type SavedAiGame } from "@/utils/savedGame";
import { useChessSound } from "@/hooks/useChessSound";
import { useChessClock } from "@/hooks/useChessClock";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import GameOverModal, { type GameResult } from "./GameOverModal";
import CapturedPieces from "./CapturedPieces";
import ConfirmModal from "@/components/ConfirmModal";
import ChessClock from "@/components/ChessClock";
import type { Difficulty } from "@/components/DifficultyModal";
import type { PlayerColor, TimeControl } from "@/components/ColorPickerModal";

interface GameScreenProps {
  onLeave?: () => void;
  difficulty?: Difficulty;
  playerColor?: PlayerColor;
  timeControl?: TimeControl;
  savedGame?: SavedAiGame;
}

function detectGameOver(game: Chess, playerColor: PlayerColor): GameResult | null {
  if (!game.isGameOver()) return null;
  const aiColor = playerColor === "w" ? "b" : "w";
  if (game.isCheckmate())
    return { outcome: game.turn() === aiColor ? "win" : "loss", reason: "checkmate" };
  if (game.isStalemate()) return { outcome: "draw", reason: "stalemate" };
  if (game.isThreefoldRepetition()) return { outcome: "draw", reason: "threefold" };
  if (game.isInsufficientMaterial()) return { outcome: "draw", reason: "insufficient" };
  if (game.isDraw()) return { outcome: "draw", reason: "draw" };
  return null;
}

export default function GameScreen({
  onLeave,
  difficulty = "medium",
  playerColor = "w",
  timeControl = null,
  savedGame,
}: GameScreenProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { token: authToken } = useAuth();
  const isFlipped = playerColor === "b";
  const [squareSize, setSquareSize] = useState(0);

  const [game, setGame] = useState(() => savedGame ? new Chess(savedGame.fen) : new Chess());
  const [playerCaptures, setPlayerCaptures] = useState<string[]>(savedGame?.playerCaptures ?? []);
  const [aiCaptures, setAiCaptures] = useState<string[]>(savedGame?.aiCaptures ?? []);
  const [loading, setLoading] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [moveCount, setMoveCount] = useState(savedGame?.moveCount ?? 0);
  const chessboardRef = useRef<ChessboardRef>(null);
  const { play } = useChessSound();

  const aiColor = playerColor === "w" ? "b" : "w";
  const isGameActive = moveCount > 0 && !gameResult;

  const [clockTimedOut, setClockTimedOut] = useState<"w" | "b" | null>(null);
  const clock = useChessClock(timeControl, setClockTimedOut);

  // Ref always holds latest capture/count values so async callbacks can read them
  const capturesRef = useRef({ playerCaptures, aiCaptures, moveCount });
  useEffect(() => { capturesRef.current = { playerCaptures, aiCaptures, moveCount }; });

  const doSave = useCallback((fen: string, pc: string[], ac: string[], mc: number) => {
    if (timeControl !== null) return;
    saveGame({ fen, playerCaptures: pc, aiCaptures: ac, moveCount: mc, difficulty, playerColor }).catch(() => {});
  }, [timeControl, difficulty, playerColor]);

  const finishGame = useCallback((result: GameResult) => {
    clock.pause();
    clearSavedGame().catch(() => {});
    setGameResult(result);
    if (authToken) {
      // timeControl define a modalidade Glicko-2 (bullet/blitz/rapid) no backend
      reportAiResult(authToken, result.outcome, difficulty, timeControl).catch(() => {});
    }
  }, [authToken, difficulty, clock, timeControl]);

  useEffect(() => {
    if (!clockTimedOut || gameResult) return;
    const outcome = clockTimedOut === playerColor ? "loss" : "win";
    finishGame({ outcome, reason: "timeout" });
  }, [clockTimedOut]);

  const PIECE_VALUE: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
  const playerMaterial = playerCaptures.reduce((s, p) => s + (PIECE_VALUE[p] ?? 0), 0);
  const aiMaterial = aiCaptures.reduce((s, p) => s + (PIECE_VALUE[p] ?? 0), 0);
  const playerAdvantage = playerMaterial - aiMaterial;

  const makeAIMove = useCallback(async (currentGame: Chess) => {
    setLoading(true);
    const bestMove = await getBestMove(currentGame.fen(), difficulty);
    await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 400));

    const parsed = parseUciMove(bestMove);
    if (!parsed) {
      setLoading(false);
      return;
    }

    const from = parsed.from as any;
    const to = parsed.to as any;

    const updated = new Chess(currentGame.fen());
    const aiMove = updated.move({ from, to, promotion: parsed.promotion ?? "q" });
    if (!aiMove) { setLoading(false); return; }

    await chessboardRef.current?.move({ from, to, promotion: aiMove.promotion as any });

    const newAiCaptures = aiMove.captured
      ? [...capturesRef.current.aiCaptures, aiMove.captured]
      : capturesRef.current.aiCaptures;
    if (aiMove.captured) setAiCaptures(newAiCaptures);

    const result = detectGameOver(updated, playerColor);
    if (result) {
      setGame(updated);
      finishGame(result);
      setLoading(false);
      if (result.outcome === "loss") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        play("checkmate");
        play("gameEnd");
      }
      return;
    }

    if (updated.inCheck()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      play("check");
    } else {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      play(aiMove.captured ? "capture" : "move");
    }

    setGame(new Chess(updated.fen()));
    setLoading(false);
    clock.switchTurn(playerColor);

    // Save after AI move (player's turn next — stable restore point)
    doSave(updated.fen(), capturesRef.current.playerCaptures, newAiCaptures, capturesRef.current.moveCount);
  }, [difficulty, play, playerColor, clock, doSave]);

  useEffect(() => {
    if (savedGame) {
      const restored = new Chess(savedGame.fen);
      if (restored.turn() === aiColor) makeAIMove(restored);
    } else {
      play("gameStart");
      if (playerColor === "b") makeAIMove(new Chess());
    }
  }, []);

  const handleNewGame = useCallback(async () => {
    clearSavedGame().catch(() => {});
    const fresh = new Chess();
    setGame(fresh);
    setPlayerCaptures([]);
    setAiCaptures([]);
    setGameResult(null);
    setMoveCount(0);
    setClockTimedOut(null);
    clock.reset();
    await chessboardRef.current?.resetBoard();
    play("gameStart");
    if (playerColor === "b") {
      makeAIMove(fresh);
    }
  }, [play, playerColor, makeAIMove, clock]);

  const handleResign = useCallback(() => {
    setShowResignConfirm(true);
  }, []);

  const onMove = async (data: any) => {
    try {
      if (loading || gameResult) return;
      if (game.turn() !== playerColor) return;

      const { move } = data;
      if (!move) return;

      const currentGame = new Chess(game.fen());
      // move.promotion carrega a peça escolhida no diálogo de promoção do
      // tabuleiro — "q" fixo divergiria do que o jogador viu na tela.
      const playerMove = currentGame.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion ?? "q",
      });

      if (!playerMove) return;

      const newPlayerCaptures = playerMove.captured
        ? [...playerCaptures, playerMove.captured]
        : playerCaptures;
      const newMoveCount = moveCount + 1;
      if (playerMove.captured) setPlayerCaptures(newPlayerCaptures);
      setMoveCount(newMoveCount);
      clock.switchTurn(aiColor);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      play(playerMove.captured ? "capture" : "move");

      // Save immediately after player's move (AI's turn) — fallback if user exits before AI responds
      doSave(currentGame.fen(), newPlayerCaptures, aiCaptures, newMoveCount);

      const resultAfterPlayer = detectGameOver(currentGame, playerColor);
      if (resultAfterPlayer) {
        setGame(currentGame);
        finishGame(resultAfterPlayer);
        if (resultAfterPlayer.outcome === "win") {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          play("checkmate");
        }
        return;
      }

      setGame(new Chess(currentGame.fen()));
      await makeAIMove(currentGame);
    } catch {
      setLoading(false);
      Alert.alert("Erro", "Falha ao processar jogada");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.buttonSecondary }]}>
        <Pressable style={styles.headerButton} onPress={handleNewGame} hitSlop={8}>
          <Ionicons name="refresh-outline" size={22} color={colors.text} />
        </Pressable>

        {timeControl !== null && (
          <ChessClock
            whiteMs={clock.whiteMs}
            blackMs={clock.blackMs}
            active={clock.active}
            myColor={playerColor}
            colors={colors}
          />
        )}

        <Pressable
          style={styles.headerButton}
          onPress={handleResign}
          hitSlop={8}
          disabled={!isGameActive}
        >
          <Ionicons
            name="flag-outline"
            size={22}
            color={isGameActive ? colors.error : colors.icon}
          />
        </Pressable>
      </View>

      <View style={styles.boardSection}>
        <CapturedPieces
          pieces={aiCaptures as any}
          pieceColor={playerColor}
          advantage={playerAdvantage < 0 ? -playerAdvantage : 0}
          colors={colors}
        />
        <View
          style={[styles.boardWrapper, isFlipped && styles.boardFlipped]}
          onLayout={(e) => setSquareSize(e.nativeEvent.layout.width / 8)}
        >
          <Chessboard
            ref={chessboardRef}
            fen={game.fen()}
            onMove={onMove}
            withLetters={!isFlipped}
            withNumbers={!isFlipped}
            renderPiece={isFlipped && squareSize > 0 ? (piece) => (
              <Image
                source={PIECES[piece]}
                style={{ width: squareSize, height: squareSize, transform: [{ rotate: "180deg" }] }}
              />
            ) : undefined}
          />
        </View>
        <CapturedPieces
          pieces={playerCaptures as any}
          pieceColor={aiColor}
          advantage={playerAdvantage > 0 ? playerAdvantage : 0}
          colors={colors}
        />
      </View>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      )}

      <GameOverModal
        result={gameResult}
        onNewGame={handleNewGame}
        onLeave={() => onLeave?.()}
      />

      <ConfirmModal
        visible={showResignConfirm}
        title="Abandonar partida"
        message="Tem certeza que deseja abandonar? A vitória será da IA."
        confirmLabel="Abandonar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          setShowResignConfirm(false);
          finishGame({ outcome: "loss", reason: "resign" });
        }}
        onCancel={() => setShowResignConfirm(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    padding: 6,
  },
  boardSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  boardWrapper: {},
  boardFlipped: {
    transform: [{ rotate: "180deg" }],
  },
  loading: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: [{ translateX: -25 }, { translateY: -25 }],
  },
});
