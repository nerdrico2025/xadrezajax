import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

export type PlayerColor = "w" | "b";

interface ColorPickerModalProps {
  visible: boolean;
  onSelect: (color: PlayerColor) => void;
  onCancel: () => void;
}

export default function ColorPickerModal({
  visible,
  onSelect,
  onCancel,
}: ColorPickerModalProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            Escolha sua cor
          </Text>

          <View style={styles.options}>
            <Pressable
              style={({ pressed }) => [
                styles.option,
                { opacity: pressed ? 0.75 : 1 },
              ]}
              onPress={() => onSelect("w")}
            >
              <Text style={styles.piece}>♔</Text>
              <Text style={[styles.optionLabel, { color: colors.text }]}>
                Brancas
              </Text>
              <Text style={[styles.optionSub, { color: colors.secondary }]}>
                Você começa
              </Text>
            </Pressable>

            <View style={[styles.divider, { backgroundColor: colors.buttonSecondary }]} />

            <Pressable
              style={({ pressed }) => [
                styles.option,
                { opacity: pressed ? 0.75 : 1 },
              ]}
              onPress={() => onSelect("b")}
            >
              <Text style={styles.piece}>♚</Text>
              <Text style={[styles.optionLabel, { color: colors.text }]}>
                Pretas
              </Text>
              <Text style={[styles.optionSub, { color: colors.secondary }]}>
                IA começa
              </Text>
            </Pressable>
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
    marginBottom: 24,
    textAlign: "center",
  },
  options: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  option: {
    flex: 1,
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  piece: {
    fontSize: 52,
    lineHeight: 60,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: "700",
  },
  optionSub: {
    fontSize: 12,
  },
  divider: {
    width: 1,
    height: 80,
    marginHorizontal: 8,
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
