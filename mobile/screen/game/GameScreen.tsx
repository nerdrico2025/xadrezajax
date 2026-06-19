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
import { useChessSound } from "@/hooks/useChessSound";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import GameOverModal, { type GameResult } from "./GameOverModal";
import CapturedPieces from "./CapturedPieces";
import ConfirmModal from "@/components/ConfirmModal";
import type { Difficulty } from "@/components/DifficultyModal";
import type { PlayerColor } from "@/components/ColorPickerModal";

interface GameScreenProps {
  onLeave?: () => void;
  difficulty?: Difficulty;
  playerColor?: PlayerColor;
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
}: GameScreenProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const isFlipped = playerColor === "b";
  const [squareSize, setSquareSize] = useState(0);

  const [game, setGame] = useState(new Chess());
  const [playerCaptures, setPlayerCaptures] = useState<string[]>([]);
  const [aiCaptures, setAiCaptures] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [moveCount, setMoveCount] = useState(0);
  const chessboardRef = useRef<ChessboardRef>(null);
  const { play } = useChessSound();

  const isGameActive = moveCount > 0 && !gameResult;

  const PIECE_VALUE: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
  const playerMaterial = playerCaptures.reduce((s, p) => s + (PIECE_VALUE[p] ?? 0), 0);
  const aiMaterial = aiCaptures.reduce((s, p) => s + (PIECE_VALUE[p] ?? 0), 0);
  const playerAdvantage = playerMaterial - aiMaterial;
  const aiColor = playerColor === "w" ? "b" : "w";

  const makeAIMove = useCallback(async (currentGame: Chess) => {
    setLoading(true);
    const bestMove = await getBestMove(currentGame.fen(), difficulty);
    await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 400));

    if (!bestMove || bestMove.length < 4) {
      setLoading(false);
      return;
    }

    const from = bestMove.substring(0, 2) as any;
    const to = bestMove.substring(2, 4) as any;

    const updated = new Chess(currentGame.fen());
    const aiMove = updated.move({ from, to, promotion: "q" });
    if (!aiMove) { setLoading(false); return; }

    await chessboardRef.current?.move({ from, to });

    if (aiMove.captured) {
      setAiCaptures((prev) => [...prev, aiMove.captured!]);
    }

    const result = detectGameOver(updated, playerColor);
    if (result) {
      setGame(updated);
      setGameResult(result);
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
  }, [difficulty, play, playerColor]);

  useEffect(() => {
    play("gameStart");
    if (playerColor === "b") {
      makeAIMove(new Chess());
    }
  }, []);

  const handleNewGame = useCallback(async () => {
    const fresh = new Chess();
    setGame(fresh);
    setPlayerCaptures([]);
    setAiCaptures([]);
    setGameResult(null);
    setMoveCount(0);
    await chessboardRef.current?.resetBoard();
    play("gameStart");
    if (playerColor === "b") {
      makeAIMove(fresh);
    }
  }, [play, playerColor, makeAIMove]);

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
      const playerMove = currentGame.move({
        from: move.from,
        to: move.to,
        promotion: "q",
      });

      if (!playerMove) return;

      if (playerMove.captured) {
        setPlayerCaptures((prev) => [...prev, playerMove.captured!]);
      }
      setMoveCount((c) => c + 1);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      play(playerMove.captured ? "capture" : "move");

      const resultAfterPlayer = detectGameOver(currentGame, playerColor);
      if (resultAfterPlayer) {
        setGame(currentGame);
        setGameResult(resultAfterPlayer);
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
          setGameResult({ outcome: "loss", reason: "resign" });
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
