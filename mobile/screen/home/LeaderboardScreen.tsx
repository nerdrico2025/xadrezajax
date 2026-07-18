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
import { getLeaderboard, type LeaderboardEntry } from "@/services/profile";

interface Props {
  onBack: () => void;
}

const MEDAL = ["🥇", "🥈", "🥉"];

export default function LeaderboardScreen({ onBack }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getLeaderboard(50);
      setEntries(data);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const renderItem = ({ item }: { item: LeaderboardEntry }) => {
    const isMe = item.user_id === user?.id;
    const winRate = item.games_played > 0
      ? Math.round((item.wins / item.games_played) * 100)
      : 0;

    return (
      <View
        style={[
          styles.row,
          {
            backgroundColor: isMe ? colors.primary + "18" : colors.card,
            borderColor: isMe ? colors.primary + "44" : colors.divider,
          },
        ]}
      >
        <View style={styles.rankCol}>
          {item.rank <= 3 ? (
            <Text style={styles.medal}>{MEDAL[item.rank - 1]}</Text>
          ) : (
            <Text style={[styles.rankNum, { color: colors.secondary }]}>
              {item.rank}
            </Text>
          )}
        </View>
        <View style={styles.nameCol}>
          <Text style={[styles.username, { color: isMe ? colors.primary : colors.text }]} numberOfLines={1}>
            {item.username}
            {isMe ? " (você)" : ""}
          </Text>
          <Text style={[styles.meta, { color: colors.secondary }]}>
            {item.games_played} partidas · {winRate}% vitórias
          </Text>
        </View>
        {/* Destaque do próprio usuário em dourado (R2). accentOnLight passa AA no claro. */}
        <Text style={[styles.ratingText, { color: isMe ? colors.accentOnLight : colors.text }]}>
          {item.rating}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.divider }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Classificação</Text>
        <Pressable onPress={load} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="refresh-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="trophy-outline" size={48} color={colors.icon} />
          <Text style={[styles.empty, { color: colors.secondary }]}>
            Nenhum jogador ainda
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => String(item.user_id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
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
  empty: { fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  rankCol: { width: 32, alignItems: "center" },
  medal: { fontSize: 20 },
  rankNum: { fontSize: 15, fontWeight: "700" },
  nameCol: { flex: 1 },
  username: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  ratingText: { fontSize: 18, fontWeight: "800" },
});
