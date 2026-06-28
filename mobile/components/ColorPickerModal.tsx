import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

export type PlayerColor = "w" | "b";
export type TimeControl = null | number; // null = unlimited, number = seconds

const TIME_OPTIONS: { label: string; value: TimeControl; icon: string }[] = [
  { label: "Sem limite", value: null,  icon: "infinite-outline" },
  { label: "1 min",      value: 60,   icon: "flash-outline" },
  { label: "3 min",      value: 180,  icon: "timer-outline" },
  { label: "10 min",     value: 600,  icon: "time-outline" },
];

interface ColorPickerModalProps {
  visible: boolean;
  onSelect: (color: PlayerColor, timeControl: TimeControl) => void;
  onCancel: () => void;
}

export default function ColorPickerModal({ visible, onSelect, onCancel }: ColorPickerModalProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const [selectedTime, setSelectedTime] = useState<TimeControl>(180); // default 3 min

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.text }]}>Configurar partida</Text>

          {/* Color */}
          <Text style={[styles.sectionLabel, { color: colors.secondary }]}>Cor das peças</Text>
          <View style={styles.options}>
            <Pressable
              style={({ pressed }) => [styles.option, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() => onSelect("w", selectedTime)}
            >
              <Text style={styles.piece}>♔</Text>
              <Text style={[styles.optionLabel, { color: colors.text }]}>Brancas</Text>
              <Text style={[styles.optionSub, { color: colors.secondary }]}>Você começa</Text>
            </Pressable>

            <View style={[styles.divider, { backgroundColor: colors.buttonSecondary }]} />

            <Pressable
              style={({ pressed }) => [styles.option, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() => onSelect("b", selectedTime)}
            >
              <Text style={styles.piece}>♚</Text>
              <Text style={[styles.optionLabel, { color: colors.text }]}>Pretas</Text>
              <Text style={[styles.optionSub, { color: colors.secondary }]}>IA começa</Text>
            </Pressable>
          </View>

          {/* Time control */}
          <Text style={[styles.sectionLabel, { color: colors.secondary }]}>Controle de tempo</Text>
          <View style={styles.timeRow}>
            {TIME_OPTIONS.map((opt) => {
              const active = selectedTime === opt.value;
              return (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => setSelectedTime(opt.value)}
                  style={[
                    styles.timeChip,
                    {
                      backgroundColor: active ? colors.primary : colors.buttonSecondary + "40",
                      borderColor: active ? colors.primary : colors.divider,
                    },
                  ]}
                >
                  <Ionicons
                    name={opt.icon as any}
                    size={14}
                    color={active ? "#fff" : colors.secondary}
                  />
                  <Text style={[styles.timeLabel, { color: active ? "#fff" : colors.text }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={[styles.cancelText, { color: colors.secondary }]}>Cancelar</Text>
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
  card: { width: "100%", borderRadius: 20, padding: 24 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 20, textAlign: "center" },
  sectionLabel: {
    fontSize: 11, fontWeight: "700", letterSpacing: 0.8,
    textTransform: "uppercase", marginBottom: 12,
  },
  options: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  option: { flex: 1, alignItems: "center", gap: 8, paddingVertical: 16 },
  piece: { fontSize: 48, lineHeight: 56 },
  optionLabel: { fontSize: 16, fontWeight: "700" },
  optionSub: { fontSize: 12 },
  divider: { width: 1, height: 80, marginHorizontal: 8 },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  timeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  timeLabel: { fontSize: 13, fontWeight: "600" },
  cancelButton: { alignItems: "center", paddingVertical: 8 },
  cancelText: { fontSize: 15, fontWeight: "500" },
});
