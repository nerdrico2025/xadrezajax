import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { usePlanStatus } from "@/hooks/usePlanStatus";
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
//
// REGRA DESTA SEÇÃO: um único caminho renderiza `null`, e ele é
// intencional (`inexistente` — partida que nunca teria análise). Todo o
// resto tem tela.
//
// A versão anterior tinha QUATRO saídas silenciosas, e o usuário não
// conseguia distinguir "não há análise para mim" de "o app quebrou":
//   1. plano não confirmado (inclusive por falha de rede na checagem);
//   2. antes da primeira resposta do polling;
//   3. `indisponivel` (sem plano) — hoje é convite a assinar;
//   4. `inexistente` — o único que continua silencioso, de propósito.

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
  /** Leva à tela de assinatura. Sem isto o convite vira só texto — a seção
   *  continua explicando por que não há análise, mas sem botão. */
  onUpgrade?: () => void;
}

export default function GameAnalysisSection({
  gamePublicId,
  playerColor = "w",
  onUpgrade,
}: GameAnalysisSectionProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { token } = useAuth();
  const planStatus = usePlanStatus();

  // Só o plano `free` CONFIRMADO evita a chamada — é a economia que motivou
  // o gate no cliente (pedir para receber "indisponivel" é gasto à toa em
  // rede móvel). Com a checagem em `error`, perguntamos ao servidor: ele é a
  // autoridade sobre o acesso, e sumir com a seção porque a CHECAGEM DE
  // PLANO falhou é o bug, não a economia.
  const shouldFetch = planStatus === "paid" || planStatus === "error";

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
    if (!shouldFetch) return;
    aliveRef.current = true;
    pollsRef.current = 0;
    fetchOnce();
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchOnce, shouldFetch]);

  const retry = useCallback(() => {
    pollsRef.current = 0;
    setGaveUp(false);
    setError(false);
    fetchOnce();
  }, [fetchOnce]);

  // ── Plano ainda desconhecido ────────────────────────────────────────
  // Placeholder neutro, não "Analisando a partida…": ainda não sabemos se
  // haverá análise para este usuário, e anunciar uma que vira convite a
  // assinar meio segundo depois é pior do que um segundo de espera honesta.
  if (planStatus === "loading") {
    return (
      <Card colors={colors}>
        <Row>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.status, { color: colors.secondary }]}>
            Carregando…
          </Text>
        </Row>
      </Card>
    );
  }

  // ── Plano Grátis, sabido de antemão ─────────────────────────────────
  // Nem chega a pedir ao servidor: a resposta seria "indisponivel".
  if (planStatus === "free") {
    return <UpgradeCard colors={colors} onUpgrade={onUpgrade} />;
  }

  // ── Falha de rede ───────────────────────────────────────────────────
  // Antes de qualquer coisa que dependa de `analysis`: se a última consulta
  // falhou, o certo é oferecer retentar, e não um spinner eterno (o polling
  // já parou) nem tela vazia.
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

  // ── Antes da primeira resposta ──────────────────────────────────────
  // O estado que faltava: a seção agora aparece desde a montagem, em vez de
  // só depois que o servidor responde.
  if (!analysis) {
    return <AnalyzingCard colors={colors} />;
  }

  // Sem plano segundo o SERVIDOR — caminho de quem chegou aqui com a
  // checagem de plano em erro. A análise pode até existir (basta o
  // adversário pagar); o conteúdo é que não é liberado.
  if (analysis.status === "indisponivel") {
    return <UpgradeCard colors={colors} onUpgrade={onUpgrade} />;
  }

  // ── O ÚNICO silêncio proposital ─────────────────────────────────────
  // Partida que nunca entraria na fila (jogada antes da feature, com a
  // análise desligada, ou sem nenhum jogador pagante). Forçar uma caixa aqui
  // encheria de ruído a tela de fim de TODA partida antiga, e não há nada a
  // oferecer nem a corrigir. Distinto de falha real: esta é a única saída
  // `null` que sobrou, e ela exige uma resposta 200 do servidor dizendo
  // exatamente isto.
  if (analysis.status === "inexistente") {
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
    if (gaveUp) {
      return (
        <Card colors={colors}>
          <Row>
            <Text style={[styles.status, { color: colors.secondary }]}>
              A análise está demorando mais que o normal.
            </Text>
            <RetryButton colors={colors} onPress={retry} />
          </Row>
        </Card>
      );
    }
    return <AnalyzingCard colors={colors} />;
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

/** "Analisando a partida…". Existe como componente porque é renderizado em
 *  DOIS momentos que antes se comportavam diferente: antes da primeira
 *  resposta (quando a tela ficava vazia) e durante o polling. */
function AnalyzingCard({
  colors,
}: {
  colors: (typeof Colors)[keyof typeof Colors];
}) {
  return (
    <Card colors={colors}>
      <Row>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={[styles.status, { color: colors.secondary }]}>
          Analisando a partida…
        </Text>
      </Row>
    </Card>
  );
}

/**
 * Convite a assinar, no lugar do silêncio que havia para quem não paga.
 *
 * Diz o que a análise MOSTRA, não só que ela é paga: quem acabou de perder
 * uma partida tem interesse genuíno em saber onde errou, e é o momento em que
 * a promessa é concreta. Copy no mesmo registro do bloqueio do Treino
 * (PuzzleScreen), para o produto falar de um jeito só.
 */
function UpgradeCard({
  colors,
  onUpgrade,
}: {
  colors: (typeof Colors)[keyof typeof Colors];
  onUpgrade?: () => void;
}) {
  return (
    <Card colors={colors}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>
          Análise da partida
        </Text>
        <Ionicons name="lock-closed" size={16} color={colors.secondary} />
      </View>
      <Text style={[styles.status, { color: colors.secondary }]}>
        Veja sua precisão, os erros e o lance que decidiu a partida — lance a
        lance. É exclusivo do Premium.
      </Text>
      {onUpgrade ? (
        <Pressable
          onPress={onUpgrade}
          style={styles.toggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Assinar o Premium para ver a análise da partida"
        >
          <Ionicons name="star" size={16} color={colors.accent} />
          <Text style={[styles.toggleText, { color: colors.accent }]}>
            Assinar Premium
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
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
  // "Não foi possível carregar a análise." + "Tentar novamente" na mesma
  // linha estouram o cartão em tela estreita; aqui também o certo é descer.
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  // "Análise da partida" + "100.0% de precisão" não cabem lado a lado num
  // cartão estreito, e texto em `flexDirection: row` não encolhe sozinho:
  // transbordava pela borda direita. Com `flexWrap`, a precisão desce para a
  // linha de baixo em vez de vazar; `flexShrink` deixa o título quebrar antes
  // disso, para o caso de faltar pouco.
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  accuracy: {
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  counts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  // `maxWidth` para o rótulo mais longo ("1 erros graves") quebrar dentro do
  // cartão em vez de esticar a linha para fora dele.
  count: {
    fontSize: 12,
    flexShrink: 1,
    maxWidth: "100%",
  },
  turning: {
    fontSize: 12,
    flexShrink: 1,
  },
  note: {
    fontSize: 11,
    fontStyle: "italic",
    flexShrink: 1,
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
