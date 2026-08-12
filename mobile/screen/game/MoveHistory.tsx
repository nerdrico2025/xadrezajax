import { View, Text, FlatList, StyleSheet } from "react-native";
import { useRef, useEffect } from "react";
import type { Colors } from "@/constants/theme";
import type { MoveClassification } from "@/services/analysis";

/** Símbolo e cor de cada classificação da análise pós-jogo.
 *
 *  Símbolo E cor, nunca só cor: a lista é lida rápido e há quem não distinga
 *  vermelho de verde. As cores são as da notação de xadrez (!! para brilhante,
 *  ?? para erro grave), não a paleta da marca. */
const CLASSIFICATION_MARK: Record<
  MoveClassification,
  { symbol: string; color: string; label: string }
> = {
  brilliant: { symbol: "!!", color: "#0F9BA3", label: "Brilhante" },
  best: { symbol: "★", color: "#2F7A4A", label: "Ótimo" },
  good: { symbol: "", color: "", label: "Bom" },
  inaccuracy: { symbol: "?!", color: "#B5622A", label: "Impreciso" },
  mistake: { symbol: "?", color: "#A63A2C", label: "Erro" },
  blunder: { symbol: "??", color: "#B3271F", label: "Erro grave" },
};

interface MoveHistoryProps {
  moves: string[];
  colors: (typeof Colors)[keyof typeof Colors];
  /** Classificação por ply (1-based), vinda da análise pós-jogo. Ausente
   *  durante a partida — a lista funciona igual, só sem marcação. */
  classifications?: Record<number, MoveClassification>;
  /** Ply do momento decisivo, destacado na lista. */
  turningPointPly?: number | null;
  /** Rola para o fim ao montar. Ligado durante a partida (o lance novo é o
   *  que importa) e DESLIGADO na análise, onde se lê do começo. */
  autoScroll?: boolean;
}

export default function MoveHistory({
  moves,
  colors,
  classifications,
  turningPointPly = null,
  autoScroll = true,
}: MoveHistoryProps) {
  const listRef = useRef<FlatList>(null);

  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      number: Math.floor(i / 2) + 1,
      white: moves[i],
      black: moves[i + 1] ?? "",
      whitePly: i + 1,
      blackPly: i + 2,
    });
  }

  useEffect(() => {
    if (autoScroll && pairs.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [moves.length, autoScroll]);

  if (pairs.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: colors.secondary }]}>
          Nenhum movimento ainda
        </Text>
      </View>
    );
  }

  /** Um lance com a marca da análise, quando houver. */
  function renderMove(san: string, ply: number, highlight: boolean) {
    const mark = classifications?.[ply]
      ? CLASSIFICATION_MARK[classifications[ply]]
      : null;
    const isTurningPoint = turningPointPly === ply;

    return (
      <View style={styles.moveCell}>
        <Text
          style={[
            styles.move,
            { color: san ? colors.text : "transparent" },
            highlight && { color: colors.primary, fontWeight: "700" },
            isTurningPoint && styles.turningPoint,
          ]}
          accessibilityLabel={
            mark ? `${san}, ${mark.label}` : san || undefined
          }
        >
          {san || "..."}
        </Text>
        {mark?.symbol ? (
          <Text style={[styles.mark, { color: mark.color }]}>{mark.symbol}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={pairs}
      keyExtractor={(item) => String(item.number)}
      contentContainerStyle={styles.list}
      // Na análise pós-jogo esta lista fica dentro da ScrollView do
      // GameOverModal. No Android, sem isto o gesto vai todo para a de fora e
      // a lista de lances não rola.
      nestedScrollEnabled
      renderItem={({ item, index }) => {
        const isLast = index === pairs.length - 1;
        // Durante a partida, o último lance é o destaque. Na análise não há
        // "lance atual", então nada é destacado por posição.
        const lastIsWhite = autoScroll && isLast && moves.length % 2 === 1;
        const lastIsBlack = autoScroll && isLast && moves.length % 2 === 0;
        return (
          <View
            style={[
              styles.row,
              index % 2 === 1 && { backgroundColor: colors.buttonSecondary + "40" },
              autoScroll && isLast && { backgroundColor: colors.primary + "18" },
            ]}
          >
            <Text style={[styles.number, { color: colors.secondary }]}>
              {item.number}.
            </Text>
            {renderMove(item.white, item.whitePly, lastIsWhite)}
            {renderMove(item.black, item.blackPly, lastIsBlack)}
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
  moveCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  move: {
    fontSize: 14,
    fontWeight: "500",
  },
  mark: {
    fontSize: 13,
    fontWeight: "700",
  },
  turningPoint: {
    textDecorationLine: "underline",
  },
});
