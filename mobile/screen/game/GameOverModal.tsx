import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { AI_LEVEL_BY_ID, type Difficulty } from "@/constants/aiGame";
import Confetti from "@/components/Confetti";
import GameAnalysisSection from "./GameAnalysisSection";
import GameFeedbackSection from "./GameFeedbackSection";
import type { NewAchievement } from "@/services/achievements";

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
  // Derrota fala do JOGADOR, não de quem ganhou ("Você perdeu" em vez de
  // "Seu oponente venceu!" / "A IA venceu!"): é mais curto — cabe em uma
  // linha nas telas estreitas, onde os textos antigos quebravam — e a tela é
  // sobre a partida de quem está lendo.
  //
  // Os dois modos dizem o mesmo de propósito. A derrota é a mesma para quem
  // perdeu, e o modo já aparece logo abaixo, na nota de rating.
  loss: {
    icon: "sad-outline",
    color: "#E53935",
    title: { ai: "Você perdeu", online: "Você perdeu" },
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
   * Identificador da partida no servidor, para a análise pós-jogo (Fase 2).
   * Ausente quando a partida não foi registrada (app/servidor antigo) — e aí
   * não há análise a pedir.
   */
  gamePublicId?: string | null;
  /** Cor que ESTE usuário jogou, para o resumo da análise ser do lado certo. */
  playerColor?: "w" | "b";
  /** Leva à tela de assinatura, para o convite da análise ter para onde ir. */
  onUpgrade?: () => void;
  /**
   * Conquistas desbloqueadas POR ESTA partida (sistema irmão do Campanha).
   *
   * PRIORIDADE DELIBERADA: quando um desbloqueio de campanha cai na mesma
   * tela, ele é a comemoração principal e estas entram como uma LINHA
   * DISCRETA abaixo — a vitória que dá o selo do nível é justamente a que
   * pode dar "3 vitórias seguidas", e duas faixas grandes empilhadas viram
   * ruído. Não há segundo confete: o Confetti é um só, ligado à vitória.
   */
  newAchievements?: NewAchievement[];
}

export default function GameOverModal({
  result,
  mode,
  ratingOutcome,
  onNewGame,
  onLeave,
  campaignUnlock,
  gamePublicId,
  playerColor = "w",
  onUpgrade,
  newAchievements,
}: GameOverModalProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  if (!result) return null;

  const config = OUTCOME_CONFIG[result.outcome];

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
        {/* O cartão rola quando não cabe. Com a análise aberta (a lista de
            lances tem 220px) o conteúdo passa da altura da tela em aparelhos
            pequenos, e como o overlay CENTRALIZA, o excesso saía pelas duas
            pontas — o topo com o troféu e o rodapé com os botões ficavam fora
            da área visível, sem como alcançá-los.

            `flexGrow: 0` é o que faz a ScrollView encolher até o tamanho do
            conteúdo (para o cartão continuar centralizado quando é curto) e
            parar na altura do overlay quando é longo. */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
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

            {/* Motivo do fim ("Xeque-mate") só na partida ranqueada. Vs IA o
                modal foi enxugado para troféu + título + o que o jogador
                GANHOU (campanha e conquistas) — o motivo é informação de
                registro, não de comemoração. */}
            {mode !== "ai" && (
              <Text style={[styles.reason, { color: colors.secondary }]}>
                {REASON_LABEL[result.reason]}
              </Text>
            )}

            {/* Rótulo de rating pelo MODO REAL da partida.
                Vs IA não há mais linha nenhuma: "não vale rating" é o estado
                permanente desse modo e repetir isso a cada partida só ocupava
                espaço sem informar. */}
            {mode !== "ai" && (
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
                  // O -16 do estilo compensa a linha de rating, que só existe
                  // no modo ranqueado. Vs IA ele encostaria a faixa no título.
                  mode === "ai" && styles.campaignBannerAi,
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

            {/* Conquistas desta partida — UM CARTÃO por conquista.
                Continuam ABAIXO da faixa da campanha: quando as duas
                coincidem, a campanha segue sendo a comemoração principal (é
                mais rara). O que mudou é o peso visual de cada conquista —
                de linha de texto para cartão com ícone grande e fundo
                tintado. Sem confete próprio: o Confetti é um só, da vitória. */}
            {newAchievements && newAchievements.length > 0 && (
              <View style={styles.achievementList}>
                {newAchievements.map((a) => (
                  <View
                    key={a.code}
                    style={[
                      styles.achievementCard,
                      {
                        backgroundColor: colors.accentMuted,
                        borderColor: colors.accent + "55",
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.achievementIconBox,
                        { backgroundColor: colors.accent },
                      ]}
                    >
                      <Ionicons
                        name={(a.icone || "trophy-outline") as any}
                        size={26}
                        // Preto sobre dourado: é o par de contraste da marca
                        // (accentText), o mesmo dos botões primários.
                        color={colors.accentText}
                      />
                    </View>
                    <View style={styles.achievementCardText}>
                      <Text
                        style={[
                          styles.achievementCardLabel,
                          { color: colors.accentOnLight },
                        ]}
                      >
                        Conquista desbloqueada
                      </Text>
                      <Text
                        style={[styles.achievementCardName, { color: colors.text }]}
                        numberOfLines={2}
                      >
                        {a.nome}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Análise pós-jogo (Fase 2). UMA condição aqui: a partida existe no
                servidor. Sem `gamePublicId` não há endereço a consultar, e a
                seção não teria o que dizer nem como dizer.

                O plano do usuário NÃO é mais decidido neste ponto. Era: a seção
                só montava com plano pago confirmado, então uma falha de rede na
                checagem (que caía para `false`) fazia a análise sumir da tela de
                quem paga, sem aviso. Agora o gate de plano mora dentro da seção,
                que tem tela para cada resultado — inclusive convite a assinar.

                MODO: vs IA não mostra mais a análise aqui — o modal de fim de
                partida vs IA foi enxugado para comemoração. A análise NÃO
                ficou inacessível: ela continua em Perfil → Atividade →
                Histórico → partida (MatchDetailScreen, PR #108), que mostra
                precisão, classificação lance a lance e o tabuleiro. Na
                partida ranqueada a seção continua exatamente como estava. */}
            {mode !== "ai" && gamePublicId && (
              <GameAnalysisSection
                gamePublicId={gamePublicId}
                playerColor={playerColor}
                onUpgrade={onUpgrade}
              />
            )}

            {/* Comentário humanizado (Fase 3), sob a MESMA condição da análise
                acima — inclusive o modo. Vs IA ele também sai: o comentário é
                DERIVADO da análise, e sem ela no modal sobraria só o convite a
                assinar (o paywall da seção), que é exatamente o ruído que este
                enxugamento veio tirar. */}
            {mode !== "ai" && gamePublicId && (
              <GameFeedbackSection
                gamePublicId={gamePublicId}
                playerColor={playerColor}
                onUpgrade={onUpgrade}
              />
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
        </ScrollView>

        {/* Confete por último para cair na FRENTE do card. `pointerEvents: none`
            dentro do componente — nunca rouba o toque dos botões. Desmonta com
            o modal (o componente inteiro sai quando `result` volta a null).

            Filho DIRETO do overlay, e o overlay não tem padding: o confete se
            posiciona por `absoluteFill`, que mede a caixa de conteúdo do pai.
            Com a margem lateral no overlay (como era), essa caixa era 2×32px
            mais estreita que a tela, enquanto as partículas sorteiam o `left`
            a partir da largura da JANELA — as da direita caíam fora do pai e
            vazavam pela borda. A margem agora mora no `scrollContent`. */}
        {result.outcome === "win" && <Confetti />}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  achievementList: { width: "100%", gap: 8, marginTop: 4, marginBottom: 16 },
  // Cartão, não linha: com o modal enxuto (vs IA), a conquista passa a ser
  // um dos poucos elementos da tela e ganha peso à altura.
  achievementCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  // Quadrado dourado SÓLIDO com o ícone em preto — o mesmo par de contraste
  // dos botões primários, em vez de ícone solto sobre fundo tintado.
  achievementIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  achievementCardText: { flex: 1, gap: 1 },
  achievementCardLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  achievementCardName: { fontSize: 15, fontWeight: "700", flexShrink: 1 },

  // Sem padding: é a moldura do confete, que precisa medir a tela inteira.
  // A margem do cartão está no `scrollContent`.
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: {
    width: "100%",
    // Encolhe até o conteúdo e para na altura do overlay — ver comentário no
    // JSX. Sem isto a ScrollView ocuparia a tela toda e o cartão colaria no
    // topo em vez de ficar centralizado.
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  card: {
    width: "100%",
    borderRadius: 20,
    // Era 32 nos dois eixos. Em tela de 320px isso deixava só 160px úteis
    // dentro do cartão — estreito demais para "Análise da partida" e
    // "100.0% de precisão" na mesma linha, que era a origem do vazamento
    // horizontal. O respiro vertical fica em 28 para a tela não achatar.
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: "center",
  },
  icon: {
    marginBottom: 16,
  },
  // `alignItems: center` do cartão só centraliza o BLOCO de texto: quando o
  // título quebra em duas linhas ("Abandono por desconexão" no motivo, ou
  // qualquer título longo no tamanho 28), o bloco passa a ocupar a largura
  // toda e as linhas ficam alinhadas à esquerda. `textAlign` é o que
  // centraliza as linhas entre si.
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  reason: {
    fontSize: 15,
    marginBottom: 12,
    textAlign: "center",
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
  campaignBannerAi: { marginTop: 4 },
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
