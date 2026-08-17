import { useState, useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useCorrespondenceGames } from "@/hooks/useCorrespondenceGames";
import { formatDeadline } from "@/utils/correspondenceTime";
import type { CorrespondenceGame } from "@/services/correspondence";

interface Props {
  onBack: () => void;
  onChallenge: () => void;
  onOpenGame: (game: CorrespondenceGame) => void;
}

export default function CorrespondenceListScreen({ onBack, onChallenge, onOpenGame }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const { games, loading, error, refresh, atLimit } = useCorrespondenceGames();

  // "expira em Xd Yh" precisa se atualizar sozinho enquanto a tela fica
  // aberta — sem isto, um prazo lido às 23h59 continuaria dizendo "0h 1min"
  // depois da meia-noite. Um tick por minuto é suficiente (o relógio é por
  // dias, não por segundos — ver docstring de CorrespondenceGame).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, borderBottomColor: colors.divider },
        ]}
      >
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Modo Turno</Text>
        <View style={styles.backBtn} />
      </View>

      {atLimit && (
        <View
          style={[
            styles.limitBanner,
            { backgroundColor: colors.accentMuted, borderColor: colors.accent + "55" },
          ]}
          accessibilityRole="alert"
        >
          <Ionicons name="hourglass-outline" size={16} color={colors.accentOnLight} />
          <Text style={[styles.limitText, { color: colors.text }]}>
            Você atingiu o limite de 2 partidas simultâneas do plano Grátis.
            Termine uma partida ou assine o Premium para partidas ilimitadas.
          </Text>
        </View>
      )}

      <Pressable
        style={[
          styles.challengeBtn,
          { backgroundColor: atLimit ? colors.buttonSecondary : colors.accent },
        ]}
        onPress={onChallenge}
        disabled={atLimit}
        accessibilityRole="button"
        accessibilityLabel={
          atLimit ? "Desafiar, indisponível no limite do plano Grátis" : "Desafiar alguém"
        }
        accessibilityState={{ disabled: atLimit }}
      >
        <Ionicons
          name="add-circle"
          size={20}
          color={atLimit ? colors.secondary : colors.accentText}
        />
        <Text
          style={[
            styles.challengeBtnText,
            { color: atLimit ? colors.secondary : colors.accentText },
          ]}
        >
          Desafiar alguém
        </Text>
      </Pressable>

      {loading && !games ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : error ? (
        <View style={[styles.errorBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.errorText, { color: colors.secondary }]}>
            Não foi possível carregar suas partidas.
          </Text>
          <Pressable onPress={refresh} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : !games || games.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="mail-open-outline" size={40} color={colors.secondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Nenhuma partida do Modo Turno ainda
          </Text>
          <Text style={[styles.emptySub, { color: colors.secondary }]}>
            Desafie um amigo ou entre na fila de pareamento para começar.
          </Text>
          <Pressable
            style={[styles.emptyCta, { backgroundColor: colors.accent }]}
            onPress={onChallenge}
            accessibilityRole="button"
          >
            <Text style={[styles.emptyCtaText, { color: colors.accentText }]}>
              Desafiar ou entrar na fila
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(g) => String(g.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
          renderItem={({ item }) => (
            <GameRow game={item} now={now} colors={colors} onPress={() => onOpenGame(item)} />
          )}
        />
      )}
    </View>
  );
}

type ThemeColors = (typeof Colors)[keyof typeof Colors];

function GameRow({
  game,
  now,
  colors,
  onPress,
}: {
  game: CorrespondenceGame;
  now: Date;
  colors: ThemeColors;
  onPress: () => void;
}) {
  const opponentName = game.opponent.username ?? game.opponent.full_name;
  const isPending = game.status === "pending";
  const isFinished = game.status === "finished";

  const turnLabel = isPending
    ? game.is_challenger
      ? "Aguardando resposta"
      : "Convite recebido"
    : isFinished
    ? "Terminada"
    : game.is_my_turn
    ? "Sua vez"
    : "Vez do adversário";

  const deadlineLabel = isPending || isFinished ? "" : formatDeadline(game.current_deadline, now);

  return (
    <Pressable
      style={[styles.row, { backgroundColor: colors.card, borderColor: colors.divider }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Partida contra ${opponentName}, ${turnLabel}${
        deadlineLabel ? `, ${deadlineLabel}` : ""
      }`}
    >
      <View style={styles.rowLeft}>
        <Text style={[styles.opponentName, { color: colors.text }]}>{opponentName}</Text>
        <Text
          style={[
            styles.turnLabel,
            { color: game.is_my_turn && !isPending && !isFinished ? colors.accentOnLight : colors.secondary },
          ]}
        >
          {turnLabel}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {deadlineLabel ? (
          <Text style={[styles.deadline, { color: colors.secondary }]}>{deadlineLabel}</Text>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={colors.secondary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  center: { paddingVertical: 24, alignItems: "center" },
  limitBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    margin: 16,
    marginBottom: 0,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  limitText: { fontSize: 13, flexShrink: 1, lineHeight: 18 },
  challengeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    margin: 16,
    marginBottom: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  challengeBtnText: { fontSize: 15, fontWeight: "700" },
  errorBox: {
    margin: 16,
    padding: 12,
    borderRadius: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  errorText: { fontSize: 13, flexShrink: 1 },
  retry: { fontSize: 13, fontWeight: "700" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  emptyCta: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12 },
  emptyCtaText: { fontSize: 14, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  rowLeft: { flexShrink: 1, gap: 4 },
  opponentName: { fontSize: 15, fontWeight: "700" },
  turnLabel: { fontSize: 13, fontWeight: "600" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  deadline: { fontSize: 12 },
});
