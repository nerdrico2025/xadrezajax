import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  type LayoutChangeEvent,
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
import { useBoardTheme } from "@/context/BoardThemeContext";
import { PROMOTION_LABELS, toChessboardColors } from "@/constants/boardThemes";
import { useAuth } from "@/context/AuthContext";
import { useChessSound } from "@/hooks/useChessSound";
import { usePuzzleSession } from "@/hooks/usePuzzleSession";
import { parseUciMove } from "@/utils/chessSpecialMoves";
import { logEvent } from "@/services/analytics";
import {
  checkPuzzleMove,
  reportPuzzleProgress,
  type PuzzleCheckMoveResult,
  type PuzzleMode,
} from "@/services/puzzles";
import SolutionArrow from "./SolutionArrow";

type Props = {
  onBack: () => void;
  onUpgrade: () => void;
  /** "daily" = Problema do dia (grátis, 4 tentativas);
   *  "training" = Treino (pago, ilimitado). */
  mode?: PuzzleMode;
};

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

export default function PuzzleScreen({ onBack, onUpgrade, mode = "daily" }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { theme: boardTheme } = useBoardTheme();
  const boardColors = toChessboardColors(boardTheme);
  const { token } = useAuth();
  const { play } = useChessSound();

  const isDaily = mode === "daily";
  const {
    state,
    setState,
    puzzle,
    stats,
    error,
    attemptsUsed,
    setAttemptsUsed,
    maxAttempts,
    reload,
    refreshStats,
  } = usePuzzleSession(mode);

  const [feedback, setFeedback] = useState<
    "ready" | "wrong" | "progress" | "offline"
  >("ready");
  const [replying, setReplying] = useState(false);
  // Lance em validação no servidor. A peça já andou no tabuleiro (a lib move
  // antes de chamar `onMove`), então o que espera a rede é só o VEREDITO —
  // mas o tabuleiro fica travado nesse meio tempo para não aceitar um segundo
  // lance em cima de um índice que ainda não avançou.
  const [checking, setChecking] = useState(false);
  // Solução revelada pelo servidor no estado terminal. Não vem mais no payload
  // do problema enquanto ele está jogável — chega pela resposta do
  // `progress/`, ou já no payload quando a tela abre num diário
  // resolvido/esgotado.
  const [revealedSolution, setRevealedSolution] = useState<string[] | null>(null);
  // Erro pendente: o lance errado fica no tabuleiro até o usuário pedir para
  // tentar de novo (o desfazer automático não deixava ver o próprio erro).
  const [pendingRetry, setPendingRetry] = useState(false);
  // Lado do tabuleiro em pixels. Medido (ver `measureBoard`), nunca herdado do
  // default da lib — é isso que garante que o tabuleiro caiba na tela.
  const [boardSize, setBoardSize] = useState(0);

  const chessboardRef = useRef<ChessboardRef>(null);
  const gameRef = useRef(new Chess());
  const solutionIndexRef = useRef(0);
  const attemptsRef = useRef(1);
  const celebration = useRef(new Animated.Value(0)).current;

  const playerColor = puzzle ? (new Chess(puzzle.fen).turn() as "w" | "b") : "w";

  // Reinicia o estado local sempre que um problema NOVO entra em cena.
  // Depende só do id de propósito: incluir `state`/`puzzle` faria o efeito
  // rodar a cada mudança de estado e resetaria o tabuleiro no meio da
  // sequência (ex.: ao passar para "solved").
  useEffect(() => {
    if (!puzzle) return;
    gameRef.current = new Chess(puzzle.fen);
    solutionIndexRef.current = 0;
    attemptsRef.current = 1;
    setFeedback("ready");
    setPendingRetry(false);
    setChecking(false);
    // Só vem preenchida quando a tela abre já num estado terminal (reabrir um
    // diário resolvido ou esgotado). Num problema jogável é `undefined`, e a
    // seta da solução fica fora de cena até o servidor revelá-la.
    setRevealedSolution(puzzle.solution ?? null);
    celebration.setValue(0);
    if (state === "playing") {
      logEvent("puzzle_started", {
        puzzle_id: puzzle.id,
        difficulty: puzzle.difficulty,
        category: puzzle.category,
        mode,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle?.id]);

  const celebrate = useCallback(() => {
    Animated.sequence([
      Animated.spring(celebration, { toValue: 1, useNativeDriver: true, friction: 4 }),
      Animated.timing(celebration, {
        toValue: 0.92,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [celebration]);

  const finishPuzzle = useCallback(async () => {
    if (!token || !puzzle) return;
    play("gameEnd");
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logEvent("puzzle_solved", {
      puzzle_id: puzzle.id,
      attempts: attemptsRef.current,
      mode,
    });
    setState("solved");
    celebrate();
    try {
      const result = await reportPuzzleProgress(
        token,
        puzzle.id,
        true,
        attemptsRef.current
      );
      // A solução chega aqui, não no payload do problema — é este canal que
      // alimenta a seta de revisão sobre o tabuleiro.
      if (result.solution) setRevealedSolution(result.solution);
    } catch {
      // Progresso é reconciliável: o próximo stats/ reflete o que o backend
      // aceitou; não bloqueia a celebração local.
    }
    await refreshStats();
  }, [token, puzzle, play, mode, setState, celebrate, refreshStats]);

  /** Registra a falha no servidor — quem conta as tentativas e decide o
   *  esgotamento é o backend, nunca a tela. */
  const registerFailure = useCallback(async () => {
    if (!token || !puzzle || !isDaily) return;
    try {
      const result = await reportPuzzleProgress(token, puzzle.id, false, 1);
      if (typeof result.attempts_used === "number") {
        setAttemptsUsed(result.attempts_used);
      }
      if (result.exhausted) {
        logEvent("puzzle_exhausted", {
          puzzle_id: puzzle.id,
          attempts: result.attempts_used ?? attemptsRef.current,
          mode,
        });
        // Esgotar revela a solução (decisão de produto: aprendizado). Ela vem
        // nesta resposta — é a única vez que o servidor a entrega sem acerto.
        if (result.solution) setRevealedSolution(result.solution);
        setState("exhausted");
        await refreshStats();
      }
    } catch {
      // Falha de rede aqui não pode travar a tela: o usuário continua
      // podendo tentar, e o servidor reconcilia na próxima chamada.
    }
  }, [token, puzzle, isDaily, mode, setAttemptsUsed, setState, refreshStats]);

  const handleRetry = useCallback(() => {
    if (!puzzle) return;
    setPendingRetry(false);
    setFeedback("ready");
    chessboardRef.current?.resetBoard(gameRef.current.fen());
  }, [puzzle]);

  /**
   * Mede a área livre entre o banner e o rodapé e deriva o lado do tabuleiro.
   *
   * Por que não deixar a lib decidir: o default do react-native-chessboard é
   * `floor(larguraDaTela / 8) * 8` — só largura, sem olhar a altura disponível.
   * Como o contêiner é `flex: 1` e o tabuleiro não encolhe (flexShrink 0 no RN),
   * em telas mais baixas o tabuleiro transbordava para cima e para baixo e
   * colidia com o banner de sucesso e com o pill de streak. Limitar pelo MENOR
   * lado da caixa medida resolve na origem.
   *
   * Múltiplo de 8 para as 8 casas fecharem em pixels inteiros (mesma razão do
   * default da lib) — sem isso a última casa e as coordenadas saem meio pixel
   * fora do lugar.
   */
  const measureBoard = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const side = Math.floor(Math.min(width, height) / 8) * 8;
    setBoardSize((prev) => (prev === side ? prev : side));
  }, []);

  const playOpponentReply = useCallback(
    async (uci: string) => {
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
    },
    [play]
  );

  const onMove = async (data: any) => {
    if (!puzzle || state !== "playing" || replying || pendingRetry || checking) return;
    const { move } = data;
    if (!move) return;
    if (gameRef.current.turn() !== playerColor) return;
    if (!token) return;

    const played = `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase();

    // Quem sabe a resposta é o servidor. A tela não tem mais `puzzle.solution`
    // enquanto o problema está jogável — era exatamente isso que vazava.
    let verdict: PuzzleCheckMoveResult | null = null;
    setChecking(true);
    try {
      verdict = await checkPuzzleMove(
        token,
        puzzle.id,
        played,
        solutionIndexRef.current
      );
    } catch {
      // Sem veredito não dá para saber se o lance estava certo, então NÃO
      // conta tentativa: cair a rede não pode custar uma das 4 do dia.
      // Desfaz o lance e devolve o tabuleiro ao usuário.
      setFeedback("offline");
      chessboardRef.current?.resetBoard(gameRef.current.fen());
      return;
    } finally {
      setChecking(false);
    }
    if (!verdict) return;

    if (!verdict.correct) {
      attemptsRef.current += 1;
      setFeedback("wrong");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (isDaily) {
        // Deixa o lance errado visível e espera o "Tentar novamente".
        setPendingRetry(true);
        await registerFailure();
      } else {
        // Treino: ilimitado, desfaz na hora para manter o ritmo.
        chessboardRef.current?.resetBoard(gameRef.current.fen());
      }
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

    // A resposta do oponente vem no veredito, não da solução local: é a
    // consequência de um lance que o usuário JÁ encontrou, e sem ela o
    // tabuleiro não teria como continuar a sequência.
    if (verdict.reply) {
      setFeedback("progress");
      await playOpponentReply(verdict.reply);
    }

    if (verdict.solved) {
      await finishPuzzle();
      return;
    }

    // O índice passa a ser o que o servidor devolveu — a tela não conta mais
    // lances por conta própria.
    if (verdict.next_index !== null) {
      solutionIndexRef.current = verdict.next_index;
    }
    setFeedback("progress");
  };

  const attemptsLeft = Math.max(0, maxAttempts - attemptsUsed);
  const feedbackText = {
    ready:
      playerColor === "w"
        ? "Brancas jogam — encontre o melhor lance"
        : "Pretas jogam — encontre o melhor lance",
    wrong: "Esse não é o melhor lance. Tente outra ideia.",
    progress: "Boa! Continue a sequência",
    // Sem rede não houve veredito — e sem veredito não houve tentativa.
    offline: "Não deu para verificar o lance. Tente de novo.",
  }[feedback];

  const title = isDaily ? "Problema do dia" : "Treino";

  // Lance certo da solução: casas de origem/destino (para desenhar no
  // tabuleiro) e SAN (para o rótulo acessível). O servidor entrega a solução no
  // estado terminal; aqui só a traduzimos.
  //
  // Em problemas de vários lances mostramos o PRIMEIRO — é o lance-chave, o que
  // o usuário precisava enxergar; a sequência inteira viraria poluição visual.
  //
  // Fonte é `revealedSolution`, não `puzzle.solution`: durante o jogo a tela
  // simplesmente não tem a solução, então não há o que desenhar mesmo que
  // alguém remova o `isTerminal` do JSX por engano.
  const solution = (() => {
    const first = revealedSolution?.[0];
    if (!puzzle || !first) return null;
    const parsed = parseUciMove(first);
    if (!parsed) return null;
    let san = first;
    try {
      const move = new Chess(puzzle.fen).move({
        from: parsed.from,
        to: parsed.to,
        promotion: parsed.promotion ?? "q",
      });
      if (move?.san) san = move.san;
    } catch {
      // Solução malformada no banco: ainda dá para destacar as casas, que é o
      // que importa aqui. Não derruba a tela.
    }
    return {
      from: parsed.from,
      to: parsed.to,
      san,
      hasMore: (revealedSolution?.length ?? 0) > 1,
    };
  })();

  /** Estado terminal: o problema acabou (acertou ou esgotou as tentativas). */
  const isTerminal = state === "solved" || state === "exhausted";

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
        <View style={styles.headerRight}>
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
          <Text style={[styles.messageSub, { color: colors.secondary }]}>{error}</Text>
          <Button title="Tentar novamente" variant="accent" onPress={reload} />
        </View>
      )}

      {state === "empty" && (
        <View style={styles.center}>
          <Ionicons name="extension-puzzle-outline" size={40} color={colors.secondary} />
          <Text style={[styles.messageTitle, { color: colors.text }]}>
            Problemas chegando em breve
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

      {/* Treino sem plano pago */}
      {state === "locked" && (
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
            O Treino é exclusivo do Premium
          </Text>
          <Text style={[styles.messageSub, { color: colors.secondary }]}>
            Resolva problemas à vontade, além do desafio diário. O Problema do
            dia continua grátis, todo dia.
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

      {(state === "playing" || isTerminal) && puzzle && (
        <View style={styles.body}>
          <View style={styles.puzzleInfo}>
            <Text style={[styles.category, { color: colors.secondary }]}>
              {CATEGORY_LABELS[puzzle.category] ?? "Tática"}
            </Text>

            {/* Contador de tentativas — só no diário (Treino é ilimitado) */}
            {isDaily && state === "playing" && maxAttempts > 0 && (
              <View style={styles.attemptsRow} accessibilityLabel={
                `Tentativa ${Math.min(attemptsUsed + 1, maxAttempts)} de ${maxAttempts}`
              }>
                {Array.from({ length: maxAttempts }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.attemptDot,
                      {
                        backgroundColor:
                          i < attemptsLeft ? colors.accent : "transparent",
                        borderColor:
                          i < attemptsLeft ? colors.accent : colors.divider,
                      },
                    ]}
                  />
                ))}
                <Text style={[styles.attemptsText, { color: colors.secondary }]}>
                  Tentativa {Math.min(attemptsUsed + 1, maxAttempts)} de {maxAttempts}
                </Text>
              </View>
            )}

            {state === "exhausted" ? (
              <View
                style={[
                  styles.solvedBanner,
                  {
                    backgroundColor: colors.accentMuted,
                    borderColor: colors.accent + "55",
                  },
                ]}
              >
                <Ionicons
                  name="hourglass-outline"
                  size={18}
                  color={colors.accentOnLight}
                />
                <Text style={[styles.solvedText, { color: colors.accentOnLight }]}>
                  Você não conseguiu desta vez
                </Text>
              </View>
            ) : state === "solved" ? (
              <Animated.View
                style={[
                  styles.solvedBanner,
                  {
                    backgroundColor: colors.accentMuted,
                    borderColor: colors.accent + "55",
                    // `clamp`: a mola passa de 1 (overshoot), e sem o limite a
                    // interpolação extrapolava — o banner crescia mais do que a
                    // folga que ele tem até o tabuleiro.
                    transform: [{ scale: celebration.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1.05],
                      extrapolate: "clamp",
                    }) }],
                    opacity: celebration.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.6, 1],
                    }),
                  },
                ]}
              >
                <Ionicons name="sparkles" size={18} color={colors.accentOnLight} />
                <Text style={[styles.solvedText, { color: colors.accentOnLight }]}>
                  Muito bem! Problema resolvido!
                </Text>
              </Animated.View>
            ) : (
              <Text
                style={[
                  styles.feedback,
                  { color: feedback === "wrong" ? colors.error : colors.text },
                ]}
              >
                {feedbackText}
              </Text>
            )}
          </View>

          <View style={styles.boardSection}>
            {/* Caixa de medição: o frame DESTA view é a área de conteúdo da
                seção (o padding fica no pai), então o que ela mede é
                exatamente o espaço em que o tabuleiro pode caber. */}
            <View style={styles.boardBox} onLayout={measureBoard}>
              {boardSize > 0 && (
                <View
                  // A chave inclui o estado terminal de propósito: remonta o
                  // tabuleiro na posição ORIGINAL do problema, desfazendo o
                  // lance errado que ficou visível. A seta só faz sentido sobre
                  // a posição em que o lance deveria ter sido jogado.
                  //
                  // `boardSize` também entra na chave porque a lib calcula a
                  // posição de cada peça UMA vez, na montagem (shared values
                  // inicializados a partir de `pieceSize`): mudar o tamanho sem
                  // remontar deixaria as peças fora das casas.
                  key={`${puzzle.id}-${isTerminal ? "solucao" : "jogando"}-${boardSize}`}
                  style={[styles.boardWrapper, { width: boardSize, height: boardSize }]}
                  accessibilityLabel={
                    isTerminal && solution
                      ? `Tabuleiro com a solução: ${solution.san}, de ${solution.from} para ${solution.to}`
                      : undefined
                  }
                >
                  <Chessboard
                    ref={chessboardRef}
                    fen={puzzle.fen}
                    boardSize={boardSize}
                    onMove={onMove}
                    colors={boardColors}
                    promotionLabels={PROMOTION_LABELS}
                    gestureEnabled={
                      state === "playing" && !replying && !pendingRetry && !checking
                    }
                  />
                  {isTerminal && solution && (
                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                      <SolutionArrow
                        from={solution.from}
                        to={solution.to}
                        size={boardSize}
                        color={colors.accent}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          <View style={styles.footer}>
            {state === "exhausted" ? (
              <>
                <Text
                  style={[styles.solutionCaption, { color: colors.secondary }]}
                >
                  {solution
                    ? `A jogada certa era ${solution.san}${solution.hasMore ? " — e a sequência continuava a partir dela" : ""}. Volte amanhã para um novo desafio.`
                    : "Volte amanhã para um novo desafio."}
                </Text>
                <Button title="Voltar ao início" variant="accent" onPress={onBack} />
              </>
            ) : state === "solved" ? (
              <>
                {stats && stats.streak > 0 && (
                  <View
                    style={[
                      styles.solvedStreak,
                      {
                        backgroundColor: colors.accentMuted,
                        borderColor: colors.accent + "55",
                      },
                    ]}
                  >
                    <Ionicons name="flame" size={18} color={colors.accentOnLight} />
                    <Text
                      style={[styles.solvedStreakText, { color: colors.accentOnLight }]}
                    >
                      {stats.streak === 1
                        ? "1 dia de sequência"
                        : `${stats.streak} dias de sequência`}
                    </Text>
                  </View>
                )}
                {isDaily ? (
                  <Button title="Voltar ao início" variant="accent" onPress={onBack} />
                ) : (
                  <Button
                    title="Próximo problema"
                    iconName="arrow-forward"
                    variant="accent"
                    onPress={reload}
                  />
                )}
              </>
            ) : pendingRetry ? (
              <Button title="Tentar novamente" variant="accent" onPress={handleRetry} />
            ) : (
              (replying || checking) && (
                <ActivityIndicator size="small" color={colors.secondary} />
              )
            )}
          </View>
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
  // A solução agora é mostrada DENTRO do tabuleiro (SolutionArrow). Esta
  // legenda é só o complemento textual — a informação principal é a seta.
  solutionCaption: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 4,
  },

  body: { flex: 1 },
  // `paddingBottom` é a folga garantida entre o banner de sucesso e a borda de
  // cima do tabuleiro — nada aqui pode encostar na fileira 8.
  puzzleInfo: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    alignItems: "center",
    gap: 6,
  },
  category: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  attemptsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  attemptDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  attemptsText: { fontSize: 12, fontWeight: "600", marginLeft: 4 },
  feedback: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  solvedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  solvedText: { fontSize: 15, fontWeight: "800" },
  boardSection: {
    flex: 1,
    paddingHorizontal: 8,
  },
  boardBox: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  // `position: relative` explícito para ancorar o absoluteFill da seta.
  boardWrapper: { position: "relative" },
  // `paddingTop` é a folga garantida entre a borda de baixo do tabuleiro (onde
  // ficam as coordenadas a–h) e o pill de streak.
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    minHeight: 96,
    justifyContent: "flex-end",
    gap: 8,
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
