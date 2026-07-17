import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

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
}

export default function GameOverModal({
  result,
  onNewGame,
  onLeave,
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

          <View style={styles.buttons}>
            <Pressable
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={onNewGame}
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.buttonText}>Novo jogo</Text>
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
