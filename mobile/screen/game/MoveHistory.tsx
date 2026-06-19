import { View, Text, FlatList, StyleSheet } from "react-native";
import { useRef, useEffect } from "react";
import type { Colors } from "@/constants/theme";

interface MoveHistoryProps {
  moves: string[];
  colors: (typeof Colors)[keyof typeof Colors];
}

export default function MoveHistory({ moves, colors }: MoveHistoryProps) {
  const listRef = useRef<FlatList>(null);

  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ number: Math.floor(i / 2) + 1, white: moves[i], black: moves[i + 1] ?? "" });
  }

  useEffect(() => {
    if (pairs.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [moves.length]);

  if (pairs.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: colors.secondary }]}>
          Nenhum movimento ainda
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={pairs}
      keyExtractor={(item) => String(item.number)}
      contentContainerStyle={styles.list}
      renderItem={({ item, index }) => {
        const isLast = index === pairs.length - 1;
        const lastIsWhite = isLast && moves.length % 2 === 1;
        const lastIsBlack = isLast && moves.length % 2 === 0;
        return (
          <View
            style={[
              styles.row,
              index % 2 === 1 && { backgroundColor: colors.buttonSecondary + "40" },
              isLast && { backgroundColor: colors.primary + "18" },
            ]}
          >
            <Text style={[styles.number, { color: colors.secondary }]}>
              {item.number}.
            </Text>
            <Text
              style={[
                styles.move,
                { color: colors.text },
                lastIsWhite && { color: colors.primary, fontWeight: "700" },
              ]}
            >
              {item.white}
            </Text>
            <Text
              style={[
                styles.move,
                { color: item.black ? colors.text : "transparent" },
                lastIsBlack && { color: colors.primary, fontWeight: "700" },
              ]}
            >
              {item.black || "..."}
            </Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingBottom: 8,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  number: {
    width: 32,
    fontSize: 13,
    fontWeight: "500",
  },
  move: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
});
