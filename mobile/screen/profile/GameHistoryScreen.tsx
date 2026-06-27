import { useCallback, useEffect, useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { Colors } from "@/constants/theme";
import { getGameHistory, type GameHistoryEntry } from "@/services/profile";

interface Props {
  onBack: () => void;
}

export default function GameHistoryScreen({ onBack }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const LIMIT = 20;

  const load = useCallback(async (offset = 0) => {
    if (!token) return;
    try {
      const data = await getGameHistory(token, LIMIT, offset);
      if (offset === 0) setHistory(data);
      else setHistory((prev) => [...prev, ...data]);
      setHasMore(data.length === LIMIT);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token]);

  useEffect(() => { load(0); }, [load]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    load(history.length);
  }, [loadingMore, hasMore, history.length, load]);

  const resultConfig = {
    win:  { label: "Vitória",  color: "#4ADE80", icon: "trophy-outline" as const },
    loss: { label: "Derrota",  color: colors.error, icon: "close-circle-outline" as const },
    draw: { label: "Empate",   color: colors.secondary, icon: "remove-circle-outline" as const },
  };

  const renderItem = ({ item }: { item: GameHistoryEntry }) => {
    const cfg = resultConfig[item.result];
    const delta = item.rating_delta > 0 ? `+${item.rating_delta}` : `${item.rating_delta}`;
    const deltaColor = item.rating_delta > 0 ? "#4ADE80" : item.rating_delta < 0 ? colors.error : colors.secondary;
    const date = new Date(item.played_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    const modeLabel = item.mode === "ai" ? "vs IA" : "Online";

    return (
      <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.divider }]}>
        <View style={[styles.resultDot, { backgroundColor: cfg.color + "22" }]}>
          <Ionicons name={cfg.icon} size={20} color={cfg.color} />
        </View>
        <View style={styles.rowCenter}>
          <Text style={[styles.opponent, { color: colors.text }]}>{item.opponent_name}</Text>
          <Text style={[styles.meta, { color: colors.secondary }]}>
            {modeLabel} · {date}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.delta, { color: deltaColor }]}>{delta}</Text>
          <Text style={[styles.rating, { color: colors.secondary }]}>{item.rating_after}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.divider }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Histórico</Text>
        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="game-controller-outline" size={48} color={colors.icon} />
          <Text style={[styles.empty, { color: colors.secondary }]}>
            Nenhuma partida registrada ainda
          </Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} /> : null
          }
        />
      )}
    </View>
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
  title: { fontSize: 17, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  empty: { fontSize: 14, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  resultDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCenter: { flex: 1 },
  opponent: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  rowRight: { alignItems: "flex-end" },
  delta: { fontSize: 15, fontWeight: "700" },
  rating: { fontSize: 12, marginTop: 2 },
});
