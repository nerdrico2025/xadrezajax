import {
  View,
  StyleSheet,
  Image,
  Pressable,
  Text,
  ActivityIndicator,
} from "react-native";
import { useRef, useState, useCallback, useEffect } from "react";
import Chessboard from "react-native-chessboard";
import type { ChessboardRef } from "react-native-chessboard";
// @ts-ignore
import { PIECES } from "react-native-chessboard/lib/commonjs/constants";
import { Chess } from "chess.js";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { useChessSound } from "@/hooks/useChessSound";
import { useChessClock } from "@/hooks/useChessClock";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useBoardTheme } from "@/context/BoardThemeContext";
import { toChessboardColors } from "@/constants/boardThemes";
import ChessClock from "@/components/ChessClock";
import CapturedPieces from "./CapturedPieces";
import ConfirmModal from "@/components/ConfirmModal";
import type { OnlineGame, GameColor } from "@/hooks/useGameSocket";
import { derivePromotion } from "@/utils/chessSpecialMoves";
import type { GameResult } from "./GameOverModal";
import GameOverModal from "./GameOverModal";

const PIECE_VALUE: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };

interface Props {
  game: OnlineGame;
  opponentDisconnected: boolean;
  moveError: string | null;
  isReconnecting?: boolean;
  incomingDrawOffer?: boolean;
  outgoingDrawOffer?: boolean;
  drawOfferDeclined?: boolean;
  onMakeMove: (from: string, to: string, promotion?: string) => void;
  onResign: () => void;
  onOfferDraw?: () => void;
  onAcceptDraw?: () => void;
  onDeclineDraw?: () => void;
  onLeave: () => void;
}

/** Count pieces by color+type to find what was captured */
function getCapturedPieceType(prevFen: string, newFen: string): string | null {
  const prevPieces = new Chess(prevFen).board().flat().filter(Boolean);
  const nextPieces = new Chess(newFen).board().flat().filter(Boolean);
  if (nextPieces.length >= prevPieces.length) return null;

  const count = (arr: typeof prevPieces) =>
    arr.reduce<Record<string, number>>((acc, p) => {
      const k = `${p!.color}${p!.type}`;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

  const prev = count(prevPieces);
  const next = count(nextPieces);

  for (const key of Object.keys(prev)) {
    if ((prev[key] ?? 0) > (next[key] ?? 0)) return key[1]; // just the type char
  }
  return null;
}

export default function OnlineGameScreen({
  game,
  opponentDisconnected,
  moveError,
  isReconnecting = false,
  incomingDrawOffer = false,
  outgoingDrawOffer = false,
  drawOfferDeclined = false,
  onMakeMove,
  onResign,
  onOfferDraw,
  onAcceptDraw,
  onDeclineDraw,
  onLeave,
}: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { theme: boardTheme } = useBoardTheme();
  const boardColors = toChessboardColors(boardTheme);
  const { play } = useChessSound();
  const chessboardRef = useRef<ChessboardRef>(null);
  const [squareSize, setSquareSize] = useState(0);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [showDrawConfirm, setShowDrawConfirm] = useState(false);
  const [localFen, setLocalFen] = useState(game.fen);
  const [myCaptures, setMyCaptures] = useState<string[]>([]);
  const [opponentCaptures, setOpponentCaptures] = useState<string[]>([]);
  const [movePending, setMovePending] = useState(false);
  const movePendingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFlipped = game.myColor === "b";
  const opponentColor: GameColor = game.myColor === "w" ? "b" : "w";
  const isMyTurn = game.turn === game.myColor && !game.gameOver && !movePending;

  const clock = useChessClock(game.timeControl ?? null);

  // Sync clock times from server on each move
  useEffect(() => {
    if (game.whiteTimeMs === null && game.blackTimeMs === null) return;
    clock.syncTimes(game.whiteTimeMs, game.blackTimeMs);
    if (!game.gameOver) {
      clock.switchTurn(game.turn);
    } else {
      clock.pause();
    }
  }, [game.whiteTimeMs, game.blackTimeMs, game.turn, game.gameOver]);

  // Reset movePending whenever server confirms any state change
  useEffect(() => {
    setMovePending(false);
    if (movePendingTimeout.current) clearTimeout(movePendingTimeout.current);
  }, [game.fen]);

  // Reset movePending immediately on server-side move rejection
  useEffect(() => {
    if (!moveError) return;
    setMovePending(false);
    if (movePendingTimeout.current) clearTimeout(movePendingTimeout.current);
  }, [moveError]);

  // Apply opponent's move when game.fen changes
  useEffect(() => {
    if (game.fen === localFen) return;

    const capturedType = getCapturedPieceType(localFen, game.fen);

    // game.turn is who moves NEXT → opponent moved when game.turn === myColor
    const opponentJustMoved = game.turn === game.myColor;

    if (capturedType) {
      if (opponentJustMoved) {
        // Opponent captured one of my pieces → shown at top as my-color pieces
        setOpponentCaptures((prev) => [...prev, capturedType]);
      } else {
        // I captured opponent's piece → shown at bottom as opponent-color pieces
        setMyCaptures((prev) => [...prev, capturedType]);
      }
    }

    if (opponentJustMoved && game.lastMove) {
      // O servidor só envia { from, to } — em promoções, a peça escolhida
      // pelo oponente é deduzida do FEN para o tabuleiro não abrir o
      // diálogo de promoção localmente.
      chessboardRef.current?.move({
        from: game.lastMove.from as any,
        to: game.lastMove.to as any,
        promotion: derivePromotion(
          localFen,
          game.fen,
          game.lastMove.from,
          game.lastMove.to
        ) as any,
      });
      if (game.check) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        play("check");
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        play(capturedType ? "capture" : "move");
      }
    }

    setLocalFen(game.fen);
  }, [game.fen]);

  // Game over effects
  useEffect(() => {
    if (!game.gameOver) return;
    const myId = String(game.myColor === "w" ? game.white.id : game.black.id);
    if (!game.gameOver.winnerId) {
      play("gameEnd");
    } else if (game.gameOver.winnerId === myId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      play("checkmate");
      play("gameEnd");
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      play("checkmate");
      play("gameEnd");
    }
  }, [game.gameOver]);

  const onMove = useCallback(
    (data: any) => {
      if (!isMyTurn) return;
      const { move } = data;
      if (!move) return;
      const isPromotion =
        move.piece === "p" && (move.to[1] === "8" || move.to[1] === "1");
      setMovePending(true);
      if (movePendingTimeout.current) clearTimeout(movePendingTimeout.current);
      movePendingTimeout.current = setTimeout(() => setMovePending(false), 8000);
      // move.promotion vem do diálogo de promoção do tabuleiro
      onMakeMove(
        move.from,
        move.to,
        move.promotion ?? (isPromotion ? "q" : undefined)
      );
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      play("move");
    },
    [isMyTurn, onMakeMove, play]
  );

  const myMaterial = myCaptures.reduce((s, p) => s + (PIECE_VALUE[p] ?? 0), 0);
  const opponentMaterial = opponentCaptures.reduce(
    (s, p) => s + (PIECE_VALUE[p] ?? 0),
    0
  );
  const myAdvantage = myMaterial - opponentMaterial;

  let gameResult: GameResult | null = null;
  if (game.gameOver) {
    const myId = String(game.myColor === "w" ? game.white.id : game.black.id);
    const reason = (game.gameOver.reason ?? "checkmate") as GameResult["reason"];
    if (!game.gameOver.winnerId) {
      gameResult = { outcome: "draw", reason };
    } else {
      gameResult = { outcome: game.gameOver.winnerId === myId ? "win" : "loss", reason };
    }
  }

  const opponent = game.myColor === "w" ? game.black : game.white;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Reconnecting banner */}
      {isReconnecting && (
        <View style={[styles.reconnectBanner, { backgroundColor: colors.warning + "DD" }]}>
          <ActivityIndicator size="small" color="#000" />
          <Text style={styles.reconnectText}>Reconectando...</Text>
        </View>
      )}

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.buttonSecondary }]}>
        <View style={styles.opponentInfo}>
          <Pressable onPress={onLeave} hitSlop={10} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Ionicons name="person-circle-outline" size={28} color={colors.secondary} />
          <View>
            <Text style={[styles.opponentName, { color: colors.text }]}>
              {(opponent as any).username ?? `Jogador #${opponent.id}`}
            </Text>
            {(opponent as any).rating ? (
              <Text style={[styles.opponentRating, { color: colors.secondary }]}>
                {(opponent as any).rating} pts
              </Text>
            ) : opponentDisconnected ? (
              <Text style={[styles.disconnectedBadge, { color: colors.error }]}>
                Desconectado...
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.headerActions}>
          {!isMyTurn && !game.gameOver && (
            <ActivityIndicator size="small" color={colors.secondary} />
          )}
          {game.timeControl !== null && (
            <ChessClock
              whiteMs={clock.whiteMs}
              blackMs={clock.blackMs}
              active={clock.active}
              myColor={game.myColor}
              colors={colors}
            />
          )}
          <Pressable
            style={styles.headerButton}
            onPress={() => setShowDrawConfirm(true)}
            disabled={!!game.gameOver || outgoingDrawOffer}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Oferecer empate"
          >
            <Ionicons
              name="remove-circle-outline"
              size={22}
              color={game.gameOver || outgoingDrawOffer ? colors.icon : colors.text}
            />
            <Text
              style={[
                styles.headerButtonLabel,
                { color: game.gameOver || outgoingDrawOffer ? colors.icon : colors.text },
              ]}
            >
              Empate
            </Text>
          </Pressable>

          <Pressable
            style={styles.headerButton}
            onPress={() => setShowResignConfirm(true)}
            disabled={!!game.gameOver}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Desistir da partida"
          >
            <Ionicons
              name="flag-outline"
              size={22}
              color={game.gameOver ? colors.icon : colors.error}
            />
            <Text
              style={[
                styles.headerButtonLabel,
                { color: game.gameOver ? colors.icon : colors.error },
              ]}
            >
              Desistir
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Draw offer status */}
      {outgoingDrawOffer && !game.gameOver && (
        <View style={[styles.infoBanner, { backgroundColor: colors.buttonSecondary + "60" }]}>
          <ActivityIndicator size="small" color={colors.secondary} />
          <Text style={[styles.infoBannerText, { color: colors.secondary }]}>
            Proposta de empate enviada...
          </Text>
        </View>
      )}
      {drawOfferDeclined && !game.gameOver && (
        <View style={[styles.infoBanner, { backgroundColor: colors.buttonSecondary + "60" }]}>
          <Text style={[styles.infoBannerText, { color: colors.secondary }]}>
            O oponente recusou o empate.
          </Text>
        </View>
      )}

      {/* Board area */}
      <View style={styles.boardSection}>
        <CapturedPieces
          pieces={opponentCaptures as any}
          pieceColor={game.myColor}
          advantage={myAdvantage < 0 ? -myAdvantage : 0}
          colors={colors}
        />
        <View
          style={[styles.boardWrapper, isFlipped && styles.boardFlipped, { pointerEvents: isMyTurn ? "auto" : "none" }]}
          onLayout={(e) => setSquareSize(e.nativeEvent.layout.width / 8)}
        >
          <Chessboard
            ref={chessboardRef}
            fen={localFen}
            onMove={onMove}
            colors={boardColors}
            withLetters={!isFlipped}
            withNumbers={!isFlipped}
            renderPiece={
              isFlipped && squareSize > 0
                ? (piece) => (
                    <Image
                      source={PIECES[piece]}
                      style={{
                        width: squareSize,
                        height: squareSize,
                        transform: [{ rotate: "180deg" }],
                      }}
                    />
                  )
                : undefined
            }
          />
        </View>
        <CapturedPieces
          pieces={myCaptures as any}
          pieceColor={opponentColor}
          advantage={myAdvantage > 0 ? myAdvantage : 0}
          colors={colors}
        />
      </View>

      <GameOverModal
        result={gameResult}
        onNewGame={onLeave}
        onLeave={onLeave}
      />

      <ConfirmModal
        visible={showResignConfirm}
        title="Abandonar partida"
        message="Tem certeza que deseja abandonar? A vitória será do oponente."
        confirmLabel="Abandonar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          setShowResignConfirm(false);
          onResign();
        }}
        onCancel={() => setShowResignConfirm(false)}
      />

      <ConfirmModal
        visible={showDrawConfirm}
        title="Oferecer empate"
        message="Propor empate ao oponente? Ele poderá aceitar ou recusar."
        confirmLabel="Oferecer"
        cancelLabel="Cancelar"
        onConfirm={() => {
          setShowDrawConfirm(false);
          onOfferDraw?.();
        }}
        onCancel={() => setShowDrawConfirm(false)}
      />

      <ConfirmModal
        visible={incomingDrawOffer && !game.gameOver}
        title="Proposta de empate"
        message="Seu oponente ofereceu empate. Deseja aceitar?"
        confirmLabel="Aceitar"
        cancelLabel="Recusar"
        onConfirm={() => onAcceptDraw?.()}
        onCancel={() => onDeclineDraw?.()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  reconnectBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 6,
  },
  reconnectText: { fontSize: 13, fontWeight: "600", color: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  opponentInfo: { flexDirection: "row", alignItems: "center", gap: 10 },
  opponentName: { fontSize: 15, fontWeight: "600" },
  opponentRating: { fontSize: 11, marginTop: 1 },
  disconnectedBadge: { fontSize: 11 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerButton: { padding: 6, alignItems: "center", gap: 2 },
  headerButtonLabel: { fontSize: 10, fontWeight: "600" },
  infoBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 6,
  },
  infoBannerText: { fontSize: 13, fontWeight: "600" },
  boardSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  boardWrapper: {},
  boardFlipped: { transform: [{ rotate: "180deg" }] },
});
