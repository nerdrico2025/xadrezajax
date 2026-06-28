import { View, Text, Image, StyleSheet } from "react-native";
// @ts-ignore – internal import to access piece images
import { PIECES } from "react-native-chessboard/lib/commonjs/constants";
import type { Colors } from "@/constants/theme";

type PieceType = "p" | "n" | "b" | "r" | "q";
type PieceColor = "w" | "b";

interface CapturedPiecesProps {
  pieces: PieceType[];
  pieceColor: PieceColor;
  advantage: number;
  colors: (typeof Colors)[keyof typeof Colors];
}

const PIECE_VALUE: Record<PieceType, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
const SORT_ORDER: PieceType[] = ["q", "r", "b", "n", "p"];
const PIECE_SIZE = 28;

export default function CapturedPieces({
  pieces,
  pieceColor,
  advantage,
  colors,
}: CapturedPiecesProps) {
  const sorted = [...pieces].sort(
    (a, b) => PIECE_VALUE[b as PieceType] - PIECE_VALUE[a as PieceType]
  );

  return (
    <View style={styles.row}>
      {SORT_ORDER.map((type) => {
        const count = sorted.filter((p) => p === type).length;
        if (count === 0) return null;
        const key = `${pieceColor}${type}`;
        return Array.from({ length: count }).map((_, i) => (
          <Image
            key={`${type}-${i}`}
            source={PIECES[key]}
            style={styles.piece}
          />
        ));
      })}

      {advantage > 0 && (
        <Text style={[styles.advantage, { color: colors.secondary }]}>
          +{advantage}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    minHeight: PIECE_SIZE + 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    flexWrap: "wrap",
    gap: 1,
  },
  piece: {
    width: PIECE_SIZE,
    height: PIECE_SIZE,
  },
  advantage: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
});
