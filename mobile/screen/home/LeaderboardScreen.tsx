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
import Button from "@/components/Button";
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
  // Falha do último fetch. Antes o catch engolia o erro em silêncio: a tela
  // ficava exibindo a lista anterior sem nenhum indício de que os dados
  // estavam velhos — foi assim que uma conta já EXCLUÍDA continuou aparecendo
  // no ranking durante o teste em device. Regra do PR #77: erro sempre visível.
  const [error, setError] = useState<string | null>(null);
  // `entries` sozinho não distingue "nunca carregou" de "carregou vazio" — e
  // vazio é um estado legítimo aqui (ninguém jogou partida ranqueada ainda).
  // Sem isto, uma falha depois de um carregamento vazio cairia na tela de
  // erro de primeiro carregamento, que é o estado errado.
  const [everLoaded, setEverLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getLeaderboard(50);
      setEntries(data);
      setEverLoaded(true);
      setError(null);
    } catch (e: unknown) {
      // Mantém `entries` como está de propósito: com dados já na tela, some
      // o ranking inteiro seria pior que mostrá-lo marcado como desatualizado.
      setError((e as Error)?.message ?? "Falha ao carregar a classificação");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const renderItem = ({ item }: { item: LeaderboardEntry }) => {
    const isMe = item.user_id === user?.id;

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
          {/* Só o nº de partidas ranqueadas da modalidade — o mesmo conjunto
              que produziu o rating ao lado. A taxa de vitórias saiu: as
              vitórias só existem como total do perfil (com vs IA dentro), e
              dividir uma pela outra dava porcentagem sem significado (podia
              passar de 100%). */}
          <Text style={[styles.meta, { color: colors.secondary }]}>
            {item.games_played}{" "}
            {item.games_played === 1 ? "partida ranqueada" : "partidas ranqueadas"}
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

      {/* Falha COM dados já na tela: a lista continua visível, marcada como
          possivelmente desatualizada. Mesmo padrão do aviso de reconexão da
          partida online (OnlineGameScreen) — faixa em colors.warning. */}
      {error && everLoaded && (
        <View
          style={[styles.staleBanner, { backgroundColor: colors.warning + "DD" }]}
          accessibilityLiveRegion="polite"
        >
          <Ionicons name="cloud-offline-outline" size={15} color="#000" />
          <Text style={styles.staleText}>
            Não foi possível atualizar o ranking — os dados podem estar
            desatualizados.
          </Text>
          <Pressable
            onPress={load}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Tentar novamente"
          >
            <Text style={styles.staleRetry}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !everLoaded ? (
        /* PRIMEIRO carregamento falhou: não há o que mostrar, então é estado
           de erro cheio — mesmo desenho da PuzzleScreen (ícone, título, causa
           e botão de retry). Nunca tela em branco. */
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.icon} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>
            Não foi possível carregar
          </Text>
          <Text style={[styles.errorSub, { color: colors.secondary }]}>{error}</Text>
          <Button title="Tentar novamente" variant="accent" onPress={load} />
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
  // Estado de erro do primeiro carregamento (padrão da PuzzleScreen).
  errorTitle: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  errorSub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 32,
  },
  // Faixa de dado velho (padrão do aviso de reconexão da partida online).
  // Texto preto porque o fundo é o amarelo de cautela do tema.
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  staleText: { flex: 1, fontSize: 12, fontWeight: "600", color: "#000" },
  staleRetry: {
    fontSize: 12,
    fontWeight: "800",
    color: "#000",
    textDecorationLine: "underline",
  },
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
