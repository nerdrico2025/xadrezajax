import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

export type Difficulty = "easy" | "medium" | "hard";

const LEVELS: {
  id: Difficulty;
  label: string;
  description: string;
  icon: string;
  color: string;
}[] = [
  {
    id: "easy",
    label: "Fácil",
    description: "Ideal para iniciantes",
    icon: "leaf-outline",
    color: "#4CAF50",
  },
  {
    id: "medium",
    label: "Médio",
    description: "Um bom desafio",
    icon: "flame-outline",
    color: "#FF9800",
  },
  {
    id: "hard",
    label: "Difícil",
    description: "Máximo da IA",
    icon: "skull-outline",
    color: "#E53935",
  },
];

interface DifficultyModalProps {
  visible: boolean;
  onSelect: (difficulty: Difficulty) => void;
  onCancel: () => void;
}

export default function DifficultyModal({
  visible,
  onSelect,
  onCancel,
}: DifficultyModalProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            Escolha a dificuldade
          </Text>

          <View style={styles.levels}>
            {LEVELS.map((level) => (
              <Pressable
                key={level.id}
                style={({ pressed }) => [
                  styles.levelButton,
                  { borderColor: level.color, opacity: pressed ? 0.75 : 1 },
                ]}
                onPress={() => onSelect(level.id)}
              >
                <Ionicons name={level.icon as any} size={28} color={level.color} />
                <View style={styles.levelText}>
                  <Text style={[styles.levelLabel, { color: colors.text }]}>
                    {level.label}
                  </Text>
                  <Text style={[styles.levelDescription, { color: colors.secondary }]}>
                    {level.description}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.icon} />
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={[styles.cancelText, { color: colors.secondary }]}>
              Cancelar
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    borderRadius: 20,
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 20,
    textAlign: "center",
  },
  levels: {
    gap: 12,
    marginBottom: 16,
  },
  levelButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  levelText: {
    flex: 1,
  },
  levelLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  levelDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  cancelButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
