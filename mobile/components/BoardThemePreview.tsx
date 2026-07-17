import { Image, View } from "react-native";
// @ts-ignore – internal import to access piece images (mesma fonte usada no jogo)
import { PIECES } from "react-native-chessboard/lib/commonjs/constants";

import type { BoardTheme } from "@/constants/boardThemes";

type PieceKey = keyof typeof PIECES;

// Miniatura 4x4 com peças reais das duas cores, incluindo peça preta sobre casa
// escura e peça branca sobre casa escura — expõe o contraste peça/casa do tema.
const COLS = 4;
const ROWS = 4;
// row,col (0 = topo/esquerda). Casa clara quando (row+col) é par.
const PREVIEW_PIECES: { row: number; col: number; piece: PieceKey }[] = [
  { row: 0, col: 1, piece: "bq" }, // preta em casa escura
  { row: 1, col: 0, piece: "wn" }, // branca em casa escura
  { row: 2, col: 3, piece: "bp" }, // preta em casa escura
  { row: 3, col: 2, piece: "wk" }, // branca em casa escura
];

interface Props {
  theme: BoardTheme;
  size?: number;
}

export default function BoardThemePreview({ theme, size = 76 }: Props) {
  const square = size / COLS;

  return (
    <View
      style={{ width: size, height: (size / COLS) * ROWS, overflow: "hidden" }}
      accessibilityLabel={`Prévia do tabuleiro ${theme.name}`}
    >
      {Array.from({ length: ROWS }).map((_, row) => (
        <View key={row} style={{ flexDirection: "row" }}>
          {Array.from({ length: COLS }).map((_, col) => {
            const isLight = (row + col) % 2 === 0;
            const piece = PREVIEW_PIECES.find(
              (p) => p.row === row && p.col === col
            );
            return (
              <View
                key={col}
                style={{
                  width: square,
                  height: square,
                  backgroundColor: isLight
                    ? theme.lightSquare
                    : theme.darkSquare,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {piece && (
                  <Image
                    source={PIECES[piece.piece]}
                    style={{ width: square, height: square }}
                    resizeMode="contain"
                  />
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
