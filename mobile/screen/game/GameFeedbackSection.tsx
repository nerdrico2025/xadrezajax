import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { usePlanStatus } from "@/hooks/usePlanStatus";
import {
  getGameLLMFeedback,
  isFeedbackPending,
  requestGameLLMFeedback,
  type GameLLMFeedback,
} from "@/services/analysis";
import UpgradeCard, { AnalysisCard } from "./AnalysisPaywallCard";

// Comentário humanizado da partida (Fase 3), logo abaixo da análise Stockfish.
//
// COMPLEMENTA a Fase 2: aquela diz O QUE aconteceu (precisão, classificação de
// cada lance), esta diz o que isso SIGNIFICA, em português de treinador.
//
// Duas diferenças de comportamento em relação à seção da Fase 2, e as duas são
// consequência de a geração ser SOB DEMANDA e CUSTAR DINHEIRO:
//
//   1. Não pergunta sozinha em polling desde a montagem. Faz UM GET para saber
//      o estado e para aí. Só depois que o usuário pede é que o polling começa.
//   2. Antes da primeira resposta renderiza `null`, e não um cartão "carregando"
//      como a Fase 2 faz. A flag desta feature nasce DESLIGADA, então o estado
//      mais provável hoje é `desligado` — e um spinner que aparece e some em
//      toda tela de fim de partida seria ruído puro. A Fase 2 mostra o cartão
//      porque lá a análise é esperada; aqui ela pode legitimamente não existir.

/** Mesma cadência da análise (Fase 2) — não inventar ritmo próprio.
 *  A API não manda `retry_after_ms`; se um dia mandar, é aqui que entra. */
const POLL_MS = 4000;

/** Teto de tentativas (~2 min), igual ao da Fase 2. Passado isso a tela para
 *  de perguntar e devolve o controle ao usuário. */
const MAX_POLLS = 30;

const SECTION_LABELS: { key: keyof SectionMap; label: string }[] = [
  { key: "abertura", label: "Abertura" },
  { key: "erro_decisivo", label: "Momento decisivo" },
  { key: "recomendacao", label: "Para treinar" },
];

type SectionMap = {
  resumo: string;
  abertura: string;
  erro_decisivo: string;
  recomendacao: string;
};

type ThemeColors = (typeof Colors)[keyof typeof Colors];

interface GameFeedbackSectionProps {
  gamePublicId: string;
  /** Cor que ESTE usuário jogou. O texto do servidor é neutro ("as brancas"),
   *  então é a tela que diz de que lado o leitor estava. */
  playerColor?: "w" | "b";
  onUpgrade?: () => void;
}

export default function GameFeedbackSection({
  gamePublicId,
  playerColor = "w",
  onUpgrade,
}: GameFeedbackSectionProps) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { token } = useAuth();
  const planStatus = usePlanStatus();

  // Mesmo critério da Fase 2: só o Grátis CONFIRMADO evita a chamada. Com a
  // checagem em erro, perguntamos ao servidor — ele é a autoridade.
  const shouldFetch = planStatus === "paid" || planStatus === "error";

  const [feedback, setFeedback] = useState<GameLLMFeedback | null>(null);
  const [error, setError] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const pollsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Aplica um estado novo e agenda o próximo GET só se ainda está gerando. */
  const apply = useCallback(
    (data: GameLLMFeedback, poll: () => void) => {
      setFeedback(data);
      setError(false);
      if (!isFeedbackPending(data.status)) {
        // Saiu de `gerando` (pronto ou erro): o polling PARA aqui.
        clearTimer();
        return;
      }
      pollsRef.current += 1;
      if (pollsRef.current >= MAX_POLLS) {
        setGaveUp(true);
        return;
      }
      timerRef.current = setTimeout(poll, POLL_MS);
    },
    [clearTimer]
  );

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getGameLLMFeedback(token, gamePublicId);
      if (!aliveRef.current) return;
      apply(data, poll);
    } catch {
      if (!aliveRef.current) return;
      setError(true);
    }
  }, [token, gamePublicId, apply]);

  // Consulta inicial: UMA vez, só para saber o estado. Não inicia polling —
  // nada está gerando ainda.
  useEffect(() => {
    if (!shouldFetch) return;
    aliveRef.current = true;
    pollsRef.current = 0;
    poll();
    return () => {
      aliveRef.current = false;
      clearTimer();
    };
  }, [poll, shouldFetch, clearTimer]);

  const generate = useCallback(async () => {
    if (!token || requesting) return;
    setRequesting(true);
    setError(false);
    setGaveUp(false);
    pollsRef.current = 0;
    try {
      const data = await requestGameLLMFeedback(token, gamePublicId);
      if (!aliveRef.current) return;
      apply(data, poll);
    } catch {
      if (!aliveRef.current) return;
      setError(true);
    } finally {
      if (aliveRef.current) setRequesting(false);
    }
  }, [token, gamePublicId, requesting, apply, poll]);

  // ── Plano ────────────────────────────────────────────────────────────
  if (planStatus === "loading") return null;
  if (planStatus === "free") {
    return <UpgradeCard colors={colors} onUpgrade={onUpgrade} />;
  }

  // ── Falha de rede ────────────────────────────────────────────────────
  // ANTES de qualquer coisa que dependa de `feedback`, e pela mesma razão da
  // Fase 2: se a última consulta falhou, o certo é oferecer retentar. Sem
  // isto, uma falha na PRIMEIRA consulta caía no `null` logo abaixo e a seção
  // sumia em silêncio — o bug que a Fase 2 existe para não repetir.
  if (error) {
    return (
      <AnalysisCard colors={colors}>
        <View style={styles.row}>
          <Text style={[styles.status, { color: colors.secondary }]}>
            Não foi possível carregar o comentário.
          </Text>
          <LinkButton
            colors={colors}
            label="Tentar novamente"
            accessibilityLabel="Tentar carregar o comentário novamente"
            onPress={poll}
          />
        </View>
      </AnalysisCard>
    );
  }

  // ── Antes da primeira resposta ───────────────────────────────────────
  // Silêncio deliberado (ver o comentário do topo): com a flag desligada,
  // um spinner apareceria e sumiria em toda tela de fim de partida.
  if (!feedback) return null;

  if (feedback.status === "indisponivel") {
    return <UpgradeCard colors={colors} onUpgrade={onUpgrade} />;
  }

  // Feature desligada no servidor: seção some inteira, sem placeholder.
  if (feedback.status === "desligado") return null;

  if (feedback.status === "bloqueado") {
    return (
      <AnalysisCard colors={colors}>
        <Text style={[styles.status, { color: colors.secondary }]}>
          O comentário fica disponível assim que a análise da partida terminar.
        </Text>
      </AnalysisCard>
    );
  }

  if (feedback.status === "inexistente") {
    return (
      <AnalysisCard colors={colors}>
        <Header colors={colors} />
        <Text style={[styles.pitch, { color: colors.secondary }]}>
          Um comentário em português sobre como a partida foi, o momento que
          virou o jogo e o que treinar depois dela.
        </Text>
        <GenerateButton
          colors={colors}
          busy={requesting}
          onPress={generate}
        />
      </AnalysisCard>
    );
  }

  if (feedback.status === "gerando") {
    if (gaveUp) {
      return (
        <AnalysisCard colors={colors}>
          <View style={styles.row}>
            <Text style={[styles.status, { color: colors.secondary }]}>
              O comentário está demorando mais que o normal.
            </Text>
            <LinkButton
              colors={colors}
              label="Verificar de novo"
              accessibilityLabel="Verificar o comentário de novo"
              onPress={() => {
                pollsRef.current = 0;
                setGaveUp(false);
                poll();
              }}
            />
          </View>
        </AnalysisCard>
      );
    }
    return (
      <AnalysisCard colors={colors}>
        <View style={styles.row}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.status, { color: colors.secondary }]}>
            Gerando comentário…
          </Text>
        </View>
      </AnalysisCard>
    );
  }

  if (feedback.status === "erro") {
    // `failure_reason` existe na resposta e é DE PROPÓSITO ignorado: é texto
    // técnico ("timeout", "json invalido") sobre o qual o usuário não pode
    // agir. O que ele precisa saber é se dá para tentar de novo.
    const canRetry = feedback.can_retry !== false;
    return (
      <AnalysisCard colors={colors}>
        <View style={styles.row}>
          <Text style={[styles.status, { color: colors.secondary }]}>
            {canRetry
              ? "Não foi possível gerar o comentário desta vez."
              : "Não foi possível gerar o comentário desta partida."}
          </Text>
          {canRetry ? (
            <LinkButton
              colors={colors}
              label="Tentar de novo"
              accessibilityLabel="Tentar gerar o comentário de novo"
              onPress={generate}
            />
          ) : null}
        </View>
      </AnalysisCard>
    );
  }

  // ── Pronto ───────────────────────────────────────────────────────────
  const sections = feedback.sections;
  if (!sections) return null;

  return (
    <AnalysisCard colors={colors}>
      <Header colors={colors} />
      {/* O texto do servidor é neutro; a perspectiva é dita aqui. */}
      <Text style={[styles.perspective, { color: colors.accent }]}>
        {playerColor === "w" ? "Você jogou de brancas" : "Você jogou de pretas"}
      </Text>
      <Text style={[styles.resumo, { color: colors.text }]}>
        {sections.resumo}
      </Text>
      {SECTION_LABELS.map(({ key, label }) => {
        const value = sections[key];
        if (!value) return null;
        return (
          <View key={key} style={styles.block}>
            <Text style={[styles.blockLabel, { color: colors.secondary }]}>
              {label}
            </Text>
            <Text style={[styles.blockText, { color: colors.text }]}>
              {value}
            </Text>
          </View>
        );
      })}
    </AnalysisCard>
  );
}

function Header({ colors }: { colors: ThemeColors }) {
  return (
    <View style={styles.headerRow}>
      <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} />
      <Text style={[styles.title, { color: colors.text }]}>
        Comentário da partida
      </Text>
    </View>
  );
}

function GenerateButton({
  colors,
  busy,
  onPress,
}: {
  colors: ThemeColors;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={[
        styles.cta,
        { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      accessibilityLabel="Gerar comentário da partida"
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.accentText} />
      ) : (
        <Text style={[styles.ctaText, { color: colors.accentText }]}>
          Gerar comentário
        </Text>
      )}
    </Pressable>
  );
}

function LinkButton({
  colors,
  label,
  accessibilityLabel,
  onPress,
}: {
  colors: ThemeColors;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.link, { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  // Mesma disciplina do cartão da Fase 2: em tela estreita o texto e o botão
  // descem em vez de vazar pela borda.
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  status: {
    fontSize: 13,
    flexShrink: 1,
  },
  pitch: {
    fontSize: 12,
    lineHeight: 17,
    flexShrink: 1,
  },
  cta: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    minHeight: 36,
    justifyContent: "center",
    marginTop: 2,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: "700",
  },
  perspective: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  resumo: {
    fontSize: 13,
    lineHeight: 19,
    flexShrink: 1,
  },
  block: {
    gap: 2,
  },
  blockLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  blockText: {
    fontSize: 13,
    lineHeight: 19,
    flexShrink: 1,
  },
  link: {
    fontSize: 13,
    fontWeight: "600",
  },
});
