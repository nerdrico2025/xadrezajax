import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { AI_LEVEL_BY_ID, type Difficulty } from "@/constants/aiGame";

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
  | "timeout";

export type GameResult = {
  outcome: GameOutcome;
  reason: GameEndReason;
};

// Vitória usa colors.accent (Dourado AJAX, RF-VISUAL-01) — resolvido no
// render porque o token vem do tema.
const OUTCOME_CONFIG: Record<
  GameOutcome,
  { icon: string; color: string | null; title: string }
> = {
  win: { icon: "trophy", color: null, title: "Você venceu!" },
  loss: { icon: "sad-outline", color: "#E53935", title: "IA venceu!" },
  draw: { icon: "remove-circle-outline", color: "#9BA1A6", title: "Empate!" },
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
  timeout: "Tempo esgotado",
};

interface GameOverModalProps {
  result: GameResult | null;
  onNewGame: () => void;
  onLeave: () => void;
  /** Modo Campanha: presente só quando esta vitória dominou um nível. */
  campaignUnlock?: CampaignUnlockInfo | null;
}

export default function GameOverModal({
  result,
  onNewGame,
  onLeave,
  campaignUnlock,
}: GameOverModalProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];

  if (!result) return null;

  const config = OUTCOME_CONFIG[result.outcome];

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
            {config.title}
          </Text>

          <Text style={[styles.reason, { color: colors.secondary }]}>
            {REASON_LABEL[result.reason]}
          </Text>

          {/* Clareza no fim da partida vs IA (decisão D1): sem jargão técnico. */}
          <Text style={[styles.ratingNote, { color: colors.secondary }]}>
            Partida contra a IA — seu rating não mudou.
          </Text>

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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    marginBottom: 28,
  },
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
