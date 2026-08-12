import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/context/AuthContext";
import { Colors } from "@/constants/theme";
import { AI_LEVEL_BY_ID, type Difficulty } from "@/constants/aiGame";
import {
  getGameAnalysis,
  getGameDetail,
  GameDetailError,
  type GameAnalysis,
  type GameDetail,
  type MoveClassification,
} from "@/services/analysis";
import MoveHistory from "./MoveHistory";
import AnalysisPaywallCard from "./AnalysisPaywallCard";

/**
 * Detalhe de uma partida do histórico: os lances jogados e, quando existe, a
 * análise do Stockfish.
 *
 * TRÊS ESTADOS que não podem se confundir, e é por isso que a tela busca
 * DUAS coisas em vez de uma:
 *
 *   1. pagante com análise      → lances marcados + resumo;
 *   2. pagante SEM análise      → "Análise não disponível", e os lances
 *      aparecem do mesmo jeito. A partida existe; só nunca foi para a fila
 *      (jogada antes da feature, ou sem nenhum pagante na mesa na época).
 *      NÃO leva convite a assinar — quem já paga não tem o que assinar;
 *   3. não-pagante              → a mesma caixa de bloqueio da tela de fim de
 *      partida (AnalysisPaywallCard), e nenhum lance.
 *
 * O 403 da partida é o que separa (3) dos outros dois: é o único erro que
 * esta tela trata como CONTEÚDO. Ver GameDetailError.
 */

const RESULT_LABEL: Record<GameDetail["result"], string> = {
  white: "Brancas venceram",
  black: "Pretas venceram",
  draw: "Empate",
};

const TERMINATION_LABEL: Record<string, string> = {
  checkmate: "Xeque-mate",
  stalemate: "Afogamento",
  repetition: "Repetição de posição",
  insufficient: "Material insuficiente",
  draw: "Regra dos 50 lances",
  agreement: "Acordo mútuo",
  resign: "Abandono",
  abandon: "Abandono por desconexão",
  timeout: "Tempo esgotado",
};

const SUMMARY_ORDER: MoveClassification[] = [
  "brilliant",
  "best",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
];

const SUMMARY_LABEL: Record<MoveClassification, string> = {
  brilliant: "Brilhantes",
  best: "Ótimos",
  good: "Bons",
  inaccuracy: "Imprecisos",
  mistake: "Erros",
  blunder: "Erros graves",
};

interface Props {
  gamePublicId: string;
  onBack: () => void;
  /** Leva à tela de planos. Mesma rota do convite no fim de partida. */
  onUpgrade?: () => void;
}

type Estado =
  | { tipo: "carregando" }
  | { tipo: "bloqueado" }
  | { tipo: "erro" }
  | { tipo: "pronto"; game: GameDetail; analysis: GameAnalysis | null };

export default function MatchDetailScreen({
  gamePublicId,
  onBack,
  onUpgrade,
}: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });

  const carregar = useCallback(async () => {
    if (!token) return;
    setEstado({ tipo: "carregando" });
    try {
      const game = await getGameDetail(token, gamePublicId);
      // A análise é OPCIONAL e vem depois: sem ela a tela ainda tem o que
      // mostrar (os lances). Falha aqui não derruba a tela inteira.
      let analysis: GameAnalysis | null = null;
      try {
        const data = await getGameAnalysis(token, gamePublicId);
        analysis = data.status === "pronta" ? data : null;
      } catch {
        analysis = null;
      }
      setEstado({ tipo: "pronto", game, analysis });
    } catch (e) {
      if (e instanceof GameDetailError && e.kind === "forbidden") {
        setEstado({ tipo: "bloqueado" });
        return;
      }
      setEstado({ tipo: "erro" });
    }
  }, [token, gamePublicId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const header = (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + 8, borderBottomColor: colors.divider },
      ]}
    >
      <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Partida</Text>
      <View style={{ width: 42 }} />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {header}

      {estado.tipo === "carregando" ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : estado.tipo === "bloqueado" ? (
        // Estado 3. A mesma caixa da tela de fim de partida — mesma promessa,
        // mesma copy, mesmo destino.
        <View style={styles.blockedWrap}>
          <Ionicons name="lock-closed" size={40} color={colors.secondary} />
          <AnalysisPaywallCard colors={colors} onUpgrade={onUpgrade} bare />
        </View>
      ) : estado.tipo === "erro" ? (
        <View style={styles.centered}>
          <Text style={[styles.status, { color: colors.secondary }]}>
            Não foi possível carregar a partida.
          </Text>
          <Pressable
            onPress={carregar}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Tentar carregar a partida novamente"
          >
            <Text style={[styles.link, { color: colors.accent }]}>
              Tentar novamente
            </Text>
          </Pressable>
        </View>
      ) : (
        <Conteudo
          game={estado.game}
          analysis={estado.analysis}
          colors={colors}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

function Conteudo({
  game,
  analysis,
  colors,
  bottomInset,
}: {
  game: GameDetail;
  analysis: GameAnalysis | null;
  colors: (typeof Colors)[keyof typeof Colors];
  bottomInset: number;
}) {
  const side = game.player_color === "w" ? analysis?.white : analysis?.black;
  const analysisMoves = analysis?.moves ?? [];

  const classifications: Record<number, MoveClassification> = {};
  for (const move of analysisMoves) {
    if (move.classification) classifications[move.ply] = move.classification;
  }

  const opponent =
    game.player_color === "w" ? game.black_name : game.white_name;
  const aiLabel =
    game.mode === "ai" && game.ai_difficulty
      ? AI_LEVEL_BY_ID[game.ai_difficulty as Difficulty]?.label
      : null;
  const date = game.ended_at
    ? new Date(game.ended_at).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.scroll,
        { paddingBottom: bottomInset + 24 },
      ]}
    >
      {/* Cabeçalho da partida */}
      <View style={styles.summary}>
        <Text style={[styles.opponent, { color: colors.text }]}>
          {aiLabel ? `IA · ${aiLabel}` : opponent || "Adversário"}
        </Text>
        <Text style={[styles.resultLine, { color: colors.secondary }]}>
          {RESULT_LABEL[game.result]}
          {game.termination && TERMINATION_LABEL[game.termination]
            ? ` · ${TERMINATION_LABEL[game.termination]}`
            : ""}
        </Text>
        <Text style={[styles.meta, { color: colors.secondary }]}>
          {[
            game.player_color === "w" ? "Você de brancas" : "Você de pretas",
            date,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>

      {/* Resumo da análise, quando existe */}
      {analysis ? (
        <View style={[styles.card, { borderColor: colors.buttonSecondary }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Análise da partida
            </Text>
            {side?.accuracy !== null && side?.accuracy !== undefined ? (
              <Text style={[styles.accuracy, { color: colors.accent }]}>
                {side.accuracy.toFixed(1)}% de precisão
              </Text>
            ) : null}
          </View>

          <View style={styles.counts}>
            {SUMMARY_ORDER.map((key) => {
              const value = side?.counts?.[key] ?? 0;
              if (!value) return null;
              return (
                <Text key={key} style={[styles.count, { color: colors.secondary }]}>
                  {value} {SUMMARY_LABEL[key].toLowerCase()}
                </Text>
              );
            })}
          </View>

          {analysis.turning_point_ply ? (
            <Text style={[styles.turning, { color: colors.secondary }]}>
              A partida virou no lance{" "}
              {Math.ceil(analysis.turning_point_ply / 2)}.
            </Text>
          ) : null}

          {(analysis.total_plies ?? 0) > (analysis.analyzed_plies ?? 0) ? (
            <Text style={[styles.note, { color: colors.secondary }]}>
              Partida longa: analisamos os primeiros {analysis.analyzed_plies}{" "}
              lances.
            </Text>
          ) : null}
        </View>
      ) : (
        // Estado 2: pagante, partida sem análise. Sem CTA — quem já paga não
        // tem o que assinar, e oferecer o Premium aqui seria ruído.
        <View style={[styles.card, { borderColor: colors.buttonSecondary }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Análise não disponível para esta partida
          </Text>
          <Text style={[styles.status, { color: colors.secondary }]}>
            Esta partida não foi analisada. Partidas jogadas a partir de agora
            entram na fila automaticamente.
          </Text>
        </View>
      )}

      {/* Os lances. Existem com ou sem análise — sem ela, sem marcações. */}
      <View style={styles.movesHeader}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Lances</Text>
        {game.moves_truncated ? (
          <Text style={[styles.note, { color: colors.secondary }]}>
            {game.moves.length} de {game.ply_count} guardados
          </Text>
        ) : null}
      </View>

      <View style={[styles.movesBox, { borderColor: colors.buttonSecondary }]}>
        <MoveHistory
          moves={game.moves}
          colors={colors}
          classifications={classifications}
          turningPointPly={analysis?.turning_point_ply ?? null}
          // Revisão se lê do começo — o fim não é o que importa aqui.
          autoScroll={false}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  blockedWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 28,
  },
  scroll: { padding: 16, gap: 16 },
  summary: { gap: 4 },
  opponent: { fontSize: 20, fontWeight: "700" },
  resultLine: { fontSize: 14 },
  meta: { fontSize: 12 },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  accuracy: { fontSize: 14, fontWeight: "700", flexShrink: 1 },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  count: { fontSize: 12, flexShrink: 1, maxWidth: "100%" },
  turning: { fontSize: 12, flexShrink: 1 },
  note: { fontSize: 11, fontStyle: "italic", flexShrink: 1 },
  status: { fontSize: 13, flexShrink: 1 },
  link: { fontSize: 13, fontWeight: "600" },
  movesHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  // Altura fixa: a lista de lances é uma FlatList e precisa de caixa medida
  // dentro da ScrollView da tela.
  movesBox: {
    height: 380,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
});
