import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  getGameAnalysis,
  isAnalysisPending,
  type GameAnalysis,
  type MoveClassification,
} from "@/services/analysis";
import MoveHistory from "./MoveHistory";

// Análise pós-jogo na tela de fim de partida.
//
// O servidor analisa em background e o app PERGUNTA se já ficou pronta — não
// há push. Uma partida típica leva menos de um minuto, então o usuário ou vê
// o resultado chegar, ou volta depois pelo histórico e já está lá.

/** De quanto em quanto tempo perguntar de novo. */
const POLL_MS = 4000;

/** Teto de tentativas (~2 min). Passado isso a tela para de perguntar e
 *  oferece um botão — uma tela que fica girando para sempre é pior do que uma
 *  que assume que não deu e deixa o usuário decidir. */
const MAX_POLLS = 30;

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

interface GameAnalysisSectionProps {
  /** Identificador da partida no servidor. Sem ele não há o que buscar. */
  gamePublicId: string;
  /** Cor que ESTE usuário jogou — define de qual lado o resumo é mostrado. */
  playerColor?: "w" | "b";
}

export default function GameAnalysisSection({
  gamePublicId,
  playerColor = "w",
}: GameAnalysisSectionProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { token } = useAuth();

  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [error, setError] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const pollsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Evita `setState` depois que a tela sumiu (o modal desmonta ao sair da
  // partida, e a resposta pode chegar depois disso).
  const aliveRef = useRef(true);

  const fetchOnce = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getGameAnalysis(token, gamePublicId);
      if (!aliveRef.current) return;
      setAnalysis(data);
      setError(false);

      if (isAnalysisPending(data.status)) {
        pollsRef.current += 1;
        if (pollsRef.current >= MAX_POLLS) {
          setGaveUp(true);
          return;
        }
        timerRef.current = setTimeout(fetchOnce, POLL_MS);
      }
    } catch {
      if (!aliveRef.current) return;
      // Falha de rede não é falha da análise: mostra o aviso e deixa retentar.
      setError(true);
    }
  }, [token, gamePublicId]);

  useEffect(() => {
    aliveRef.current = true;
    pollsRef.current = 0;
    fetchOnce();
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchOnce]);

  const retry = useCallback(() => {
    pollsRef.current = 0;
    setGaveUp(false);
    setError(false);
    fetchOnce();
  }, [fetchOnce]);

  // Nada a mostrar: partida anterior à feature, ou usuário sem plano pago
  // (que nem deveria chegar aqui — ver o gate em GameOverModal).
  if (
    !analysis ||
    analysis.status === "inexistente" ||
    analysis.status === "indisponivel"
  ) {
    if (error) {
      return (
        <Card colors={colors}>
          <Row>
            <Text style={[styles.status, { color: colors.secondary }]}>
              Não foi possível carregar a análise.
            </Text>
            <RetryButton colors={colors} onPress={retry} />
          </Row>
        </Card>
      );
    }
    return null;
  }

  if (analysis.status === "falhou") {
    return (
      <Card colors={colors}>
        <Text style={[styles.status, { color: colors.secondary }]}>
          Não foi possível analisar esta partida.
        </Text>
      </Card>
    );
  }

  if (isAnalysisPending(analysis.status)) {
    return (
      <Card colors={colors}>
        <Row>
          {gaveUp ? (
            <>
              <Text style={[styles.status, { color: colors.secondary }]}>
                A análise está demorando mais que o normal.
              </Text>
              <RetryButton colors={colors} onPress={retry} />
            </>
          ) : (
            <>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[styles.status, { color: colors.secondary }]}>
                Analisando a partida…
              </Text>
            </>
          )}
        </Row>
      </Card>
    );
  }

  // ── Pronta ──────────────────────────────────────────────────────────
  const side = playerColor === "w" ? analysis.white : analysis.black;
  const moves = analysis.moves ?? [];
  const classifications: Record<number, MoveClassification> = {};
  for (const move of moves) {
    if (move.classification) classifications[move.ply] = move.classification;
  }
  const truncated =
    (analysis.total_plies ?? 0) > (analysis.analyzed_plies ?? 0);

  return (
    <Card colors={colors}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>
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
            <Text
              key={key}
              style={[styles.count, { color: colors.secondary }]}
            >
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

      {truncated ? (
        <Text style={[styles.note, { color: colors.secondary }]}>
          Partida longa: analisamos os primeiros {analysis.analyzed_plies} lances.
        </Text>
      ) : null}

      <Pressable
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? "Ocultar lances analisados" : "Ver lances analisados"
        }
      >
        <Text style={[styles.toggleText, { color: colors.accent }]}>
          {expanded ? "Ocultar lances" : "Ver lance a lance"}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.accent}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.list}>
          <MoveHistory
            moves={moves.map((m) => m.san)}
            colors={colors}
            classifications={classifications}
            turningPointPly={analysis.turning_point_ply ?? null}
            // Na análise se lê do começo — o fim não é o que importa.
            autoScroll={false}
          />
        </View>
      ) : null}
    </Card>
  );
}

function Card({
  colors,
  children,
}: {
  colors: (typeof Colors)[keyof typeof Colors];
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { borderColor: colors.buttonSecondary }]}>
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function RetryButton({
  colors,
  onPress,
}: {
  colors: (typeof Colors)[keyof typeof Colors];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Tentar carregar a análise novamente"
    >
      <Text style={[styles.toggleText, { color: colors.accent }]}>
        Tentar novamente
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
  },
  accuracy: {
    fontSize: 14,
    fontWeight: "700",
  },
  counts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  count: {
    fontSize: 12,
  },
  turning: {
    fontSize: 12,
  },
  note: {
    fontSize: 11,
    fontStyle: "italic",
  },
  status: {
    fontSize: 13,
    flexShrink: 1,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 2,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "600",
  },
  list: {
    height: 220,
  },
});
