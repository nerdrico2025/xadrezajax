import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useBoardTheme } from "@/context/BoardThemeContext";
import { BOARD_THEME_ORDER, BOARD_THEMES, AJAX_GOLD } from "@/constants/boardThemes";
import BoardThemePreview from "@/components/BoardThemePreview";

interface Props {
  /** Cores do tema claro/escuro do app (para texto e bordas). */
  colors: {
    text: string;
    secondary: string;
    card: string;
    divider: string;
  };
}

// Seletor de tema de tabuleiro com prévia visual real. A troca é aplicada na
// hora (setBoardTheme persiste) e o tema ativo é marcado com borda/check dourado.
export default function BoardThemePicker({ colors }: Props) {
  const { themeId, setBoardTheme } = useBoardTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {BOARD_THEME_ORDER.map((id) => {
        const theme = BOARD_THEMES[id];
        const selected = id === themeId;
        return (
          <Pressable
            key={id}
            onPress={() => setBoardTheme(id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Tabuleiro ${theme.name}${selected ? ", selecionado" : ""}`}
            style={[
              styles.item,
              {
                backgroundColor: colors.card,
                borderColor: selected ? AJAX_GOLD : colors.divider,
                borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
              },
            ]}
          >
            <View style={styles.previewWrap}>
              <BoardThemePreview theme={theme} size={76} />
              {selected && (
                <View style={[styles.check, { backgroundColor: AJAX_GOLD }]}>
                  <Ionicons name="checkmark" size={13} color="#0D0D0D" />
                </View>
              )}
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.name,
                { color: selected ? colors.text : colors.secondary },
              ]}
            >
              {theme.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  item: {
    width: 100,
    borderRadius: 12,
    padding: 8,
    alignItems: "center",
    gap: 8,
  },
  previewWrap: { borderRadius: 6, overflow: "hidden" },
  check: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 12, fontWeight: "600", textAlign: "center" },
});
