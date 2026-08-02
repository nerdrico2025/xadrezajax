import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { AI_LEVEL_BY_ID, type Difficulty } from "@/constants/aiGame";
import { QA_SHOW_AI_DIAGNOSTIC_PGN } from "@/constants/qaFlags";
import Confetti from "@/components/Confetti";

/** Modo Campanha: preenchido quando a vitória atual cruzou o limiar de 3
 * vitórias no nível jogado — dominatedLevel ganhou o selo; nextLevel é o
 * próximo tier desbloqueado (null no Mestre, que não tem próximo). */
export interface CampaignUnlockInfo {
  dominatedLevel: Difficulty;
  nextLevel: Difficulty | null;
}

export type GameOutcome = "win" | "loss" | "draw";
export type GameEndReason =
  | "checkmate"
  | "stalemate"
  | "threefold"
  | "repetition"
  | "insufficient"
  | "draw"
  | "agreement"
  | "resign"
  | "abandon"
  | "timeout";

export type GameResult = {
  outcome: GameOutcome;
  reason: GameEndReason;
};

/** Contra quem foi a partida. O modal é o MESMO componente nas duas telas
 *  (GameScreen e OnlineGameScreen), então o modo precisa ser dito — não dá
 *  para assumir. Era exatamente esse o bug: o modal se dizia "vs IA" também
 *  em partida humana. */
export type GameMode = "ai" | "online";

/**
 * O que o rating fez nesta partida, vindo do SERVIDOR (evento `game_rated`).
 * O app nunca calcula delta.
 *
 * `null` = ainda não chegou. O modal abre antes da resposta do backend de
 * propósito (ver reportAndBroadcastRating no node-api) e completa depois —
 * enquanto isso mostra que a partida vale rating, sem inventar número.
 */
export type RatingOutcome = {
  rated: boolean;
  delta: number;
  rating: number;
};

// Vitória usa colors.accent (Dourado AJAX, RF-VISUAL-01) — resolvido no
// render porque o token vem do tema.
//
// O título de derrota depende do modo: "IA venceu!" era fixo e aparecia
// também quando quem venceu era outra pessoa.
const OUTCOME_CONFIG: Record<
  GameOutcome,
  { icon: string; color: string | null; title: Record<GameMode, string> }
> = {
  win: {
    icon: "trophy",
    color: null,
    title: { ai: "Você venceu!", online: "Você venceu!" },
  },
  loss: {
    icon: "sad-outline",
    color: "#E53935",
    title: { ai: "A IA venceu!", online: "Seu oponente venceu!" },
  },
  draw: {
    icon: "remove-circle-outline",
    color: "#9BA1A6",
    title: { ai: "Empate!", online: "Empate!" },
  },
};

const REASON_LABEL: Record<GameEndReason, string> = {
  checkmate: "Xeque-mate",
  stalemate: "Afogamento",
  threefold: "Repetição de posição",
  repetition: "Repetição de posição",
  insufficient: "Material insuficiente",
  draw: "Regra dos 50 lances",
  agreement: "Acordo mútuo",
  resign: "Abandono",
  // Encerrada pelo servidor: o jogador caiu e não voltou dentro da carência.
  abandon: "Abandono por desconexão",
  timeout: "Tempo esgotado",
};

interface GameOverModalProps {
  result: GameResult | null;
  /** Contra quem foi a partida. Sem isto o modal não tem como saber, e a
   *  versão anterior chutava "vs IA" nas duas telas. */
  mode: GameMode;
  /** Resultado do rating vindo do servidor. `null` enquanto não chegou (ou
   *  quando o backend não respondeu). Ignorado em partida vs IA. */
  ratingOutcome?: RatingOutcome | null;
  onNewGame: () => void;
  onLeave: () => void;
  /** Modo Campanha: presente só quando esta vitória dominou um nível. */
  campaignUnlock?: CampaignUnlockInfo | null;
  /**
   * ⚠️ TEMPORÁRIO — INSTRUMENTAÇÃO DE DIAGNÓSTICO, NÃO É FEATURE DE PRODUTO.
   * TODO(remover): junto com utils/aiGamePgn.ts, ao fim da análise da
   * calibragem do Iniciante. Preenchido só em partidas vs IA nos níveis
   * Iniciante/Fácil; nos demais vem null e nada é renderizado.
   *
   * Só é EXIBIDO em build de preview/QA (QA_SHOW_AI_DIAGNOSTIC_PGN), e mesmo
   * lá fica atrás de um link discreto — nunca como bloco de texto aberto.
   */
  diagnosticPgn?: string | null;
}

export default function GameOverModal({
  result,
  mode,
  ratingOutcome,
  onNewGame,
  onLeave,
  campaignUnlock,
  diagnosticPgn,
}: GameOverModalProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  // Fechado por padrão: o PGN é diagnóstico, não conteúdo da tela de
  // resultado. Só existe em build de QA (ver showDiagnosticToggle).
  const [showPgn, setShowPgn] = useState(false);

  if (!result) return null;

  const config = OUTCOME_CONFIG[result.outcome];
  const showDiagnosticToggle = QA_SHOW_AI_DIAGNOSTIC_PGN && !!diagnosticPgn;

  // Delta em dourado na vitória, vermelho na queda, cinza no zero. Sem
  // laranja em nenhuma variação (regra dura da marca).
  const deltaColor =
    !ratingOutcome || ratingOutcome.delta === 0
      ? colors.secondary
      : ratingOutcome.delta > 0
      ? colors.accentOnLight
      : colors.error;

  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Ionicons
            name={config.icon as any}
            size={64}
            color={config.color ?? colors.accent}
            style={styles.icon}
          />

          <Text style={[styles.title, { color: colors.text }]}>
            {config.title[mode]}
          </Text>

          <Text style={[styles.reason, { color: colors.secondary }]}>
            {REASON_LABEL[result.reason]}
          </Text>

          {/* Rótulo de rating pelo MODO REAL da partida. Antes era o texto de
              IA fixo, exibido também em partida humana ranqueada. */}
          {mode === "ai" ? (
            <Text
              style={[styles.ratingNote, styles.ratingNoteAi, { color: colors.secondary }]}
            >
              Partida contra a IA — não vale rating.
            </Text>
          ) : (
            <View style={styles.ratedRow}>
              <Text style={[styles.ratingNote, { color: colors.secondary }]}>
                Partida ranqueada
              </Text>
              {ratingOutcome ? (
                <View
                  style={[
                    styles.deltaChip,
                    {
                      backgroundColor: colors.accentMuted,
                      borderColor: colors.divider,
                    },
                  ]}
                  accessibilityLabel={
                    ratingOutcome.delta === 0
                      ? `Rating mantido em ${ratingOutcome.rating}`
                      : `Rating ${ratingOutcome.delta > 0 ? "subiu" : "caiu"} ` +
                        `${Math.abs(ratingOutcome.delta)} pontos, ` +
                        `agora ${ratingOutcome.rating}`
                  }
                >
                  <Text style={[styles.deltaValue, { color: deltaColor }]}>
                    {ratingOutcome.delta > 0 ? "+" : ""}
                    {ratingOutcome.delta}
                  </Text>
                  <Text style={[styles.deltaRating, { color: colors.text }]}>
                    {ratingOutcome.rating}
                  </Text>
                </View>
              ) : (
                // O modal abre antes de o servidor responder. Sem número
                // inventado: ou é o delta real do Glicko-2, ou nada.
                <Text style={[styles.deltaPending, { color: colors.secondary }]}>
                  atualizando rating…
                </Text>
              )}
            </View>
          )}

          {/* Modo Campanha: comemoração discreta, nunca bloqueia o fluxo —
              dourado é a cor de conquista (sem laranja). */}
          {campaignUnlock && (
            <View
              style={[
                styles.campaignBanner,
                { backgroundColor: colors.accentMuted, borderColor: colors.accent + "55" },
              ]}
            >
              <Ionicons name="ribbon" size={22} color={colors.accentOnLight} />
              <View style={styles.campaignBannerText}>
                <Text style={[styles.campaignBannerTitle, { color: colors.accentOnLight }]}>
                  Nível {AI_LEVEL_BY_ID[campaignUnlock.dominatedLevel].label} dominado!
                </Text>
                <Text style={[styles.campaignBannerSub, { color: colors.accentOnLight }]}>
                  {campaignUnlock.nextLevel
                    ? `Nível ${AI_LEVEL_BY_ID[campaignUnlock.nextLevel].label} desbloqueado`
                    : "Conquista final da campanha!"}
                </Text>
              </View>
            </View>
          )}

          {/* ⚠️ TEMPORÁRIO: PGN da partida para a análise da calibragem da IA.
              TODO(remover): junto com utils/aiGamePgn.ts.

              DUAS travas antes de aparecer: build de QA
              (QA_SHOW_AI_DIAGNOSTIC_PGN) E toque no link. Antes, com a flag
              ligada, era um bloco de texto grande e sempre aberto — tags
              [Event]/[Date]/... e a lista de lances ocupando o modal de
              vitória. Agora é um link pequeno, fechado por padrão.

              Texto selecionável (toque longo → Copiar) de propósito: evita
              adicionar expo-clipboard só para instrumentação temporária. */}
          {showDiagnosticToggle && (
            <>
              <Pressable
                onPress={() => setShowPgn((v) => !v)}
                hitSlop={8}
                style={styles.diagnosticToggle}
                accessibilityRole="button"
              >
                <Ionicons
                  name={showPgn ? "chevron-down" : "chevron-forward"}
                  size={12}
                  color={colors.secondary}
                />
                <Text style={[styles.diagnosticToggleText, { color: colors.secondary }]}>
                  {showPgn ? "ocultar PGN (debug)" : "ver PGN (debug)"}
                </Text>
              </Pressable>

              {showPgn && (
                <View
                  style={[
                    styles.diagnosticBox,
                    {
                      borderColor: colors.divider,
                      backgroundColor: colors.buttonSecondary,
                    },
                  ]}
                >
                  <Text style={[styles.diagnosticLabel, { color: colors.secondary }]}>
                    Diagnóstico da IA · toque e segure para copiar
                  </Text>
                  <Text
                    selectable
                    style={[styles.diagnosticPgn, { color: colors.text }]}
                    accessibilityLabel="PGN da partida para diagnóstico da calibragem da IA"
                  >
                    {diagnosticPgn}
                  </Text>
                </View>
              )}
            </>
          )}

          <View style={styles.buttons}>
            <Pressable
              style={[styles.button, { backgroundColor: colors.accent }]}
              onPress={onNewGame}
            >
              <Ionicons name="refresh" size={18} color={colors.accentText} />
              <Text style={[styles.buttonText, { color: colors.accentText }]}>Novo jogo</Text>
            </Pressable>

            <Pressable
              style={[styles.buttonOutline, { borderColor: colors.buttonSecondary }]}
              onPress={onLeave}
            >
              <Ionicons name="home-outline" size={18} color={colors.text} />
              <Text style={[styles.buttonOutlineText, { color: colors.text }]}>
                Voltar
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Confete por último para cair na FRENTE do card. `pointerEvents: none`
            dentro do componente — nunca rouba o toque dos botões. Desmonta com
            o modal (o componente inteiro sai quando `result` volta a null). */}
        {result.outcome === "win" && <Confetti />}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ⚠️ TEMPORÁRIO — remover junto com o bloco de diagnóstico.
  diagnosticToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    alignSelf: "center",
    paddingVertical: 4,
    marginBottom: 8,
  },
  diagnosticToggleText: {
    fontSize: 11,
    textDecorationLine: "underline",
  },
  diagnosticBox: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    gap: 6,
  },
  diagnosticLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  diagnosticPgn: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  reason: {
    fontSize: 15,
    marginBottom: 12,
  },
  ratingNote: {
    fontSize: 13,
    textAlign: "center",
  },
  ratingNoteAi: { marginBottom: 28 },
  // Linha "Partida ranqueada" + delta. `marginBottom` aqui em vez de no
  // ratingNote: em partida vs IA o texto é o último elemento antes dos
  // botões e mantém o espaçamento antigo.
  ratedRow: {
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  deltaChip: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  deltaValue: { fontSize: 17, fontWeight: "800" },
  deltaRating: { fontSize: 13, fontWeight: "600" },
  deltaPending: { fontSize: 12, fontStyle: "italic" },
  campaignBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: -16,
    marginBottom: 20,
  },
  campaignBannerText: { flex: 1 },
  campaignBannerTitle: { fontSize: 14, fontWeight: "800" },
  campaignBannerSub: { fontSize: 12, marginTop: 2 },
  buttons: {
    width: "100%",
    gap: 12,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  buttonOutlineText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
