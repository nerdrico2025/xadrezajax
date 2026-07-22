import { View, StyleSheet, Alert, Pressable, Image, Text } from "react-native";
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
import { getCampaignProgress } from "@/services/campaign";
import { logEvent } from "@/services/analytics";
import { saveGame, clearSavedGame, type SavedAiGame } from "@/utils/savedGame";
import { useChessSound } from "@/hooks/useChessSound";
import { useChessClock } from "@/hooks/useChessClock";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useBoardTheme } from "@/context/BoardThemeContext";
import { toChessboardColors } from "@/constants/boardThemes";
import GameOverModal, {
  type GameResult,
  type CampaignUnlockInfo,
} from "./GameOverModal";
import AiThinkingIndicator from "./AiThinkingIndicator";
import CapturedPieces from "./CapturedPieces";
import ConfirmModal from "@/components/ConfirmModal";
import ChessClock from "@/components/ChessClock";
import { AI_LEVELS, type Difficulty, type PlayerColor } from "@/constants/aiGame";

interface GameScreenProps {
  onLeave?: () => void;
  difficulty?: Difficulty;
  playerColor?: PlayerColor;
  /** Base do relógio em segundos (null = sem limite). */
  timeControl?: number | null;
  /** Incremento Fischer em segundos (0 = sem incremento). */
  increment?: number;
  savedGame?: SavedAiGame;
}

// Tempo de resposta humanizado da IA (PR D, item 8). Piso por nível — a
// jogada nunca aparece antes disso, senão parece bug e não parece xadrez.
// O piso NÃO soma ao tempo real: aplicamos max(tempoReal, piso).
const AI_MIN_MS: Record<Difficulty, [number, number]> = {
  beginner: [400, 800],
  easy: [400, 800],
  medium: [600, 1200],
  hard: [600, 600],
  master: [600, 600],
};

// Se a engine não responder em 10s, tratamos como falha (nunca deixar o jogo
// em limbo silencioso).
const AI_TIMEOUT_MS = 10000;

// ─── Recuperação de falha da IA ─────────────────────────────────────────────
// O relato do teste em device foi "a IA parou de jogar e 'Tentar novamente'
// não resolvia — só dava para abandonar". O retry reenviava a MESMA requisição
// na hora, sem espaço para a condição transitória passar, e havia caminhos que
// não levavam a estado jogável nenhum. Agora:
//   - tentativas automáticas com espera crescente ANTES de incomodar o usuário
//     (a maioria das falhas é transitória e se resolve sozinha);
//   - teto de tentativas manuais, para o botão nunca virar um loop;
//   - e, em qualquer ponto, uma saída explícita da tela.
const AI_AUTO_RETRY_DELAYS_MS = [400, 1200];
const AI_MAX_MANUAL_RETRIES = 3;

/**
 * O lance UCI é jogável nesta posição?
 *
 * Vale por si: a engine pode devolver "(none)" (posição sem lance legal), uma
 * string truncada, ou um lance que não é legal ali. Com chess.js ^1.4 `move()`
 * LANÇA nesses casos — e a exceção subia por `makeAIMove`, deixando o tabuleiro
 * travado na vez da IA. Validar aqui transforma isso numa falha tratada, que o
 * retry sabe resolver.
 */
function isPlayableUci(fen: string, uci: string | null): boolean {
  const parsed = uci ? parseUciMove(uci) : null;
  if (!parsed) return false;
  if (!/^[a-h][1-8]$/.test(parsed.from) || !/^[a-h][1-8]$/.test(parsed.to)) return false;
  try {
    return !!new Chess(fen).move({
      from: parsed.from,
      to: parsed.to,
      promotion: parsed.promotion ?? "q",
    });
  } catch {
    return false;
  }
}

function aiFloorMs(difficulty: Difficulty): number {
  const [lo, hi] = AI_MIN_MS[difficulty];
  return lo === hi ? lo : lo + Math.random() * (hi - lo);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timerRef: { current: ReturnType<typeof setTimeout> | null }
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timerRef.current = setTimeout(() => reject(new Error("ai_timeout")), ms);
    }),
  ]).finally(() => {
    // Sem isso o timer de 10s fica pendente após cada jogada (e após o
    // unmount), segurando o processo vivo — era o vazamento que derrubava
    // o worker do Jest no CI.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  });
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
  increment = 0,
  savedGame,
}: GameScreenProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { theme: boardTheme } = useBoardTheme();
  const boardColors = toChessboardColors(boardTheme);
  const { token: authToken } = useAuth();
  const isFlipped = playerColor === "b";
  const [squareSize, setSquareSize] = useState(0);

  const [game, setGame] = useState(() => savedGame ? new Chess(savedGame.fen) : new Chess());
  const [playerCaptures, setPlayerCaptures] = useState<string[]>(savedGame?.playerCaptures ?? []);
  const [aiCaptures, setAiCaptures] = useState<string[]>(savedGame?.aiCaptures ?? []);
  // `loading` = IA calculando (bloqueia a entrada do jogador e mostra o
  // indicador não-bloqueante "Pensando", nunca um overlay sobre o tabuleiro).
  const [loading, setLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  // Posição pendente para o "Tentar novamente" quando a IA falha/expira.
  const pendingAiGameRef = useRef<Chess | null>(null);
  // Quantas vezes o usuário já apertou "Tentar novamente" nesta partida.
  const aiManualRetriesRef = useRef(0);
  // Timer do timeout de 10s da jogada da IA — limpo no unmount para não
  // deixar reject/setState disparando depois que a tela morreu.
  const aiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (aiTimeoutRef.current) {
      clearTimeout(aiTimeoutRef.current);
      aiTimeoutRef.current = null;
    }
  }, []);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [campaignUnlock, setCampaignUnlock] = useState<CampaignUnlockInfo | null>(null);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [showDrawConfirm, setShowDrawConfirm] = useState(false);
  const [moveCount, setMoveCount] = useState(savedGame?.moveCount ?? 0);
  const chessboardRef = useRef<ChessboardRef>(null);
  const { play } = useChessSound();

  const aiColor = playerColor === "w" ? "b" : "w";
  const isGameActive = moveCount > 0 && !gameResult;

  const [clockTimedOut, setClockTimedOut] = useState<"w" | "b" | null>(null);
  const clock = useChessClock(timeControl, setClockTimedOut, increment);

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
    setCampaignUnlock(null);
    if (authToken) {
      // Persiste a partida vs IA no histórico/estatísticas (decisão D1: nunca
      // altera o rating). Falha não pode ser silenciosa — era a causa provável
      // de partidas "sumirem" do Perfil (diagnóstico do PR B).
      reportAiResult(authToken, result.outcome, difficulty, timeControl)
        .then(async () => {
          // Modo Campanha: só vitória progride. Busca o estado pós-partida
          // para detectar se ESTA vitória cruzou o limiar de desbloqueio —
          // vitorias === vitorias_para_desbloquear é o sinal exato (o
          // contador só sobe de 1 em 1, nunca pula), sem precisar de um
          // "antes" separado nem de mudança no retorno do ai-result.
          // Decorativo: se falhar, só não mostra a comemoração — não é
          // motivo para travar o fim de jogo nem para erro visível aqui.
          if (result.outcome !== "win") return;
          try {
            const progress = await getCampaignProgress(authToken);
            const row = progress.find((p) => p.nivel === difficulty);
            if (row && row.vitorias === row.vitorias_para_desbloquear && row.selo_concedido) {
              const idx = AI_LEVELS.findIndex((l) => l.id === difficulty);
              const next = AI_LEVELS[idx + 1] ?? null;
              setCampaignUnlock({ dominatedLevel: difficulty, nextLevel: next?.id ?? null });
            }
          } catch {
            // silencioso de propósito — ver comentário acima.
          }
        })
        .catch((e) => {
          console.error("[ai-result] falha ao registrar partida vs IA", e);
          logEvent("ai_result_error", {
            difficulty,
            time_control: timeControl,
            message: (e as Error)?.message,
          });
        });
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

  /** Pede o lance à engine, com tentativas automáticas espaçadas. Só devolve
   *  um lance COMPROVADAMENTE jogável na posição, ou null. */
  const requestAiMove = useCallback(
    async (fen: string): Promise<string | null> => {
      for (let attempt = 0; attempt <= AI_AUTO_RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) {
          const wait = AI_AUTO_RETRY_DELAYS_MS[attempt - 1];
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        let candidate: string | null = null;
        try {
          candidate = await withTimeout(
            getBestMove(fen, difficulty),
            AI_TIMEOUT_MS,
            aiTimeoutRef
          );
        } catch {
          candidate = null;
        }
        if (isPlayableUci(fen, candidate)) return candidate;
      }
      return null;
    },
    [difficulty]
  );

  const makeAIMove = useCallback(async (currentGame: Chess) => {
    setAiError(false);
    setLoading(true);

    // A engine roda no node-api (fetch), fora da thread de UI — o cálculo
    // não congela a interface. O piso de tempo abaixo é só percepção.
    const startedAt = Date.now();
    const fen = currentGame.fen();
    const bestMove = await requestAiMove(fen);

    // Piso humanizado: espera só o que FALTA para atingir o piso — nunca soma
    // ao tempo real (max(tempoReal, piso)).
    const remaining = aiFloorMs(difficulty) - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    const parsed = bestMove ? parseUciMove(bestMove) : null;
    if (!parsed) {
      // Falha ou timeout da engine: nunca deixar o jogo em limbo silencioso.
      pendingAiGameRef.current = currentGame;
      setLoading(false);
      setAiError(true);
      return;
    }

    const from = parsed.from as any;
    const to = parsed.to as any;

    const updated = new Chess(currentGame.fen());
    // `requestAiMove` já validou a legalidade nesta FEN, então `move` não
    // lança aqui. O guarda continua por robustez, e agora leva ao mesmo
    // caminho de falha recuperável — nunca a um tabuleiro travado.
    const aiMove = updated.move({ from, to, promotion: parsed.promotion ?? "q" });
    if (!aiMove) {
      pendingAiGameRef.current = currentGame;
      setLoading(false);
      setAiError(true);
      return;
    }

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
  }, [difficulty, play, playerColor, clock, doSave, requestAiMove]);

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
    setCampaignUnlock(null);
    setMoveCount(0);
    setClockTimedOut(null);
    setAiError(false);
    aiManualRetriesRef.current = 0;
    pendingAiGameRef.current = null;
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

  const handleRetryAi = useCallback(async () => {
    const pending = pendingAiGameRef.current;
    if (!pending) {
      // Sem posição pendente não há o que retomar — sair é a única saída
      // honesta, e é melhor que um botão que não faz nada.
      setAiError(false);
      onLeave?.();
      return;
    }
    aiManualRetriesRef.current += 1;
    setAiError(false);
    // `await` + `catch`: sem eles, uma rejeição aqui ficava solta e deixava
    // `loading` preso em true — o indicador "Pensando" para sempre.
    try {
      await makeAIMove(pending);
    } catch (e) {
      logEvent("ai_move_retry_error", {
        difficulty,
        attempt: aiManualRetriesRef.current,
        message: (e as Error)?.message,
      });
      setLoading(false);
      setAiError(true);
    }
  }, [makeAIMove, onLeave, difficulty]);

  const handleAbandonAi = useCallback(() => {
    setAiError(false);
    onLeave?.();
  }, [onLeave]);

  // Esgotadas as tentativas manuais, o modal para de oferecer "Tentar
  // novamente" e passa a oferecer só a saída. É a garantia dura de que este
  // caminho nunca vira um loop.
  const aiRetriesExhausted = aiManualRetriesRef.current >= AI_MAX_MANUAL_RETRIES;

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
        <Pressable
          style={styles.headerButton}
          onPress={handleNewGame}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Reiniciar partida"
        >
          <Ionicons name="refresh-outline" size={22} color={colors.text} />
          <Text style={[styles.headerButtonLabel, { color: colors.text }]}>
            Reiniciar
          </Text>
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

        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerButton}
            onPress={() => setShowDrawConfirm(true)}
            hitSlop={8}
            disabled={!isGameActive}
            accessibilityRole="button"
            accessibilityLabel="Oferecer empate"
          >
            <Ionicons
              name="remove-circle-outline"
              size={22}
              color={isGameActive ? colors.text : colors.icon}
            />
            <Text
              style={[
                styles.headerButtonLabel,
                { color: isGameActive ? colors.text : colors.icon },
              ]}
            >
              Empate
            </Text>
          </Pressable>

          <Pressable
            style={styles.headerButton}
            onPress={handleResign}
            hitSlop={8}
            disabled={!isGameActive}
            accessibilityRole="button"
            accessibilityLabel="Desistir da partida"
          >
            <Ionicons
              name="flag-outline"
              size={22}
              color={isGameActive ? colors.error : colors.icon}
            />
            <Text
              style={[
                styles.headerButtonLabel,
                { color: isGameActive ? colors.error : colors.icon },
              ]}
            >
              Desistir
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Área do oponente (IA): indicador "Pensando" não-bloqueante, fora do
          tabuleiro. Altura reservada para não empurrar o layout ao aparecer. */}
      <View style={styles.thinkingRow}>
        {loading && (
          <AiThinkingIndicator color={colors.accent} textColor={colors.secondary} />
        )}
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
            colors={boardColors}
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

      <ConfirmModal
        visible={aiError}
        title={aiRetriesExhausted ? "Não foi possível retomar" : "A IA não respondeu"}
        message={
          aiRetriesExhausted
            ? "A IA continua sem responder depois de várias tentativas. Saia da partida e tente de novo daqui a pouco."
            : "Algo atrapalhou a jogada da IA. Você pode tentar de novo ou sair da partida."
        }
        confirmLabel={aiRetriesExhausted ? "Sair da partida" : "Tentar novamente"}
        cancelLabel="Sair"
        onConfirm={aiRetriesExhausted ? handleAbandonAi : handleRetryAi}
        onCancel={handleAbandonAi}
      />

      <GameOverModal
        result={gameResult}
        onNewGame={handleNewGame}
        onLeave={() => onLeave?.()}
        campaignUnlock={campaignUnlock}
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

      <ConfirmModal
        visible={showDrawConfirm}
        title="Oferecer empate"
        message="Contra a IA o empate é aceito na hora e a partida termina empatada. Deseja continuar?"
        confirmLabel="Empatar"
        cancelLabel="Cancelar"
        onConfirm={() => {
          setShowDrawConfirm(false);
          finishGame({ outcome: "draw", reason: "agreement" });
        }}
        onCancel={() => setShowDrawConfirm(false)}
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerButton: {
    padding: 6,
    alignItems: "center",
    gap: 2,
  },
  headerButtonLabel: {
    fontSize: 10,
    fontWeight: "600",
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
  thinkingRow: {
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
});
