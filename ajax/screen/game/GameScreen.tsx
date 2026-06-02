import { View, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useState } from "react";
import Chessboard from "react-native-chessboard";
import { Chess } from "chess.js";

import { getBestMove } from "@/services/game";

export default function GameScreen() {
  const [game, setGame] = useState(new Chess());
  const [loading, setLoading] = useState(false);

  const onMove = async (data: any) => {
    try {
      if (loading) return;

      if (game.turn() !== "w") return;

      const { move } = data;
      if (!move) return;

      const currentGame = new Chess(game.fen());

      const playerMove = currentGame.move({
        from: move.from,
        to: move.to,
        promotion: "q",
      });

      if (!playerMove) return;

      setGame(new Chess(currentGame.fen()));
      setLoading(true);

      const bestMove = await getBestMove(currentGame.fen());

      await new Promise(resolve =>
        setTimeout(resolve, 300 + Math.random() * 400)
      );

      if (!bestMove || bestMove.length < 4) {
        setLoading(false);
        return;
      }

      const from = bestMove.substring(0, 2);
      const to = bestMove.substring(2, 4);

      const updatedGame = new Chess(currentGame.fen());

      const aiMove = updatedGame.move({
        from,
        to,
        promotion: "q",
      });

      if (!aiMove) {
        setLoading(false);
        return;
      }

      setGame(new Chess(updatedGame.fen()));
      setLoading(false);
    } catch (error) {
      setLoading(false);
      Alert.alert("Erro", "Falha ao processar jogada");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.boardWrapper}>
        <Chessboard
          key={game.fen()}
          fen={game.fen()}
          onMove={onMove}
        />
      </View>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
},
boardWrapper: {
  width: "100%",
  aspectRatio: 1,
  overflow: "hidden",
  paddingRight: 5,
  paddingLeft: 3.5,
},

  loading: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: [{ translateX: -25 }, { translateY: -25 }],
  },
});