import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useFriends } from "@/hooks/useFriends";
import {
  createChallenge,
  joinMatchmaking,
  leaveMatchmaking,
  CorrespondenceApiError,
  type CorrespondenceGame,
} from "@/services/correspondence";
import type { Friend } from "@/services/friends";

const TIME_CONTROLS: { days: 1 | 3 | 7; label: string }[] = [
  { days: 1, label: "1 dia por lance" },
  { days: 3, label: "3 dias por lance" },
  { days: 7, label: "7 dias por lance" },
];

interface Props {
  onBack: () => void;
  /** Desafio direto enviado (fica pendente até o alvo aceitar). */
  onChallengeSent: () => void;
  /** Pareamento instantâneo — a partida já nasce `active`. */
  onMatched: (game: CorrespondenceGame) => void;
}

export default function CorrespondenceChallengeScreen({
  onBack,
  onChallengeSent,
  onMatched,
}: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { friends, loading: friendsLoading, refresh: refreshFriends } = useFriends();

  const [timeControlDays, setTimeControlDays] = useState<1 | 3 | 7>(3);
  const [challengingId, setChallengingId] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const showLimitOrError = useCallback((e: unknown, fallback: string) => {
    if (e instanceof CorrespondenceApiError) {
      setErrorMsg(e.message);
      return;
    }
    setErrorMsg(fallback);
  }, []);

  const handleChallengeFriend = useCallback(
    async (friend: Friend) => {
      if (!token || !friend.username) return;
      setErrorMsg(null);
      setChallengingId(friend.id);
      try {
        await createChallenge(token, friend.username, timeControlDays);
        onChallengeSent();
      } catch (e) {
        showLimitOrError(e, "Não foi possível enviar o desafio.");
      } finally {
        setChallengingId(null);
      }
    },
    [token, timeControlDays, onChallengeSent, showLimitOrError]
  );

  const handleJoinMatchmaking = useCallback(async () => {
    if (!token) return;
    setErrorMsg(null);
    setSearching(true);
    try {
      const { queued, game } = await joinMatchmaking(token, timeControlDays);
      if (!queued && game) {
        onMatched(game);
      }
      // queued=true: continua na tela, com o spinner de "procurando".
    } catch (e) {
      setSearching(false);
      showLimitOrError(e, "Não foi possível entrar na fila.");
    }
  }, [token, timeControlDays, onMatched, showLimitOrError]);

  const handleCancelMatchmaking = useCallback(async () => {
    if (!token) return;
    setSearching(false);
    try {
      await leaveMatchmaking(token, timeControlDays);
    } catch {
      // Sair da fila é best-effort na UI: se falhar, o próximo pareamento
      // ainda respeita o servidor, que é a fonte de verdade da fila.
    }
  }, [token, timeControlDays]);

  const getInitial = (name: string | null | undefined) => (name ?? "?")[0].toUpperCase();

  const renderAvatar = (avatar: string | null, name: string | null | undefined, size = 44) => {
    if (avatar) {
      return (
        <Image
          source={{ uri: avatar }}
          style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        />
      );
    }
    return (
      <View
        style={[
          styles.avatarPlaceholder,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary + "25" },
        ]}
      >
        <Text style={[styles.avatarInitial, { color: colors.primary, fontSize: size * 0.4 }]}>
          {getInitial(name)}
        </Text>
      </View>
    );
  };

  const onlineFriends = friends.filter((f) => f.is_online);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.divider }]}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Desafiar</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={friendsLoading} onRefresh={refreshFriends} tintColor={colors.primary} />
        }
      >
        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>Dias por lance</Text>
        <View style={styles.timeControlRow}>
          {TIME_CONTROLS.map(({ days, label }) => (
            <Pressable
              key={days}
              onPress={() => setTimeControlDays(days)}
              style={[
                styles.timeControlPill,
                {
                  backgroundColor: timeControlDays === days ? colors.accent : colors.card,
                  borderColor: timeControlDays === days ? colors.accent : colors.divider,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: timeControlDays === days }}
            >
              <Text
                style={[
                  styles.timeControlText,
                  { color: timeControlDays === days ? colors.accentText : colors.text },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {errorMsg ? (
          <View style={[styles.errorBanner, { backgroundColor: colors.accentMuted, borderColor: colors.error + "55" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={[styles.errorBannerText, { color: colors.text }]}>{errorMsg}</Text>
          </View>
        ) : null}

        <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>
          Pareamento
        </Text>
        {searching ? (
          <View style={[styles.matchmakingBox, { backgroundColor: colors.card, borderColor: colors.divider }]}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={[styles.matchmakingText, { color: colors.text }]}>
              Procurando oponente com {timeControlDays} dia(s) por lance...
            </Text>
            <Pressable
              style={[styles.cancelBtn, { borderColor: colors.error }]}
              onPress={handleCancelMatchmaking}
              accessibilityRole="button"
              accessibilityLabel="Cancelar busca por oponente"
            >
              <Text style={[styles.cancelBtnText, { color: colors.error }]}>Cancelar</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[styles.matchmakingBtn, { backgroundColor: colors.card, borderColor: colors.divider }]}
            onPress={handleJoinMatchmaking}
            accessibilityRole="button"
            accessibilityLabel="Entrar na fila de pareamento"
          >
            <Ionicons name="shuffle" size={20} color={colors.accent} />
            <Text style={[styles.matchmakingBtnText, { color: colors.text }]}>
              Entrar na fila (qualquer adversário)
            </Text>
          </Pressable>
        )}

        <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>
          Amigos online
        </Text>
        {onlineFriends.length === 0 ? (
          <Text style={[styles.emptyFriends, { color: colors.secondary }]}>
            Nenhum amigo online agora. Tente o pareamento acima.
          </Text>
        ) : (
          onlineFriends.map((friend) => (
            <View
              key={friend.id}
              style={[styles.friendRow, { borderBottomColor: colors.divider }]}
            >
              <View style={styles.avatarWrapper}>
                {renderAvatar(friend.avatar, friend.username ?? friend.full_name)}
                <View style={[styles.onlineDot, { backgroundColor: "#22c55e" }]} />
              </View>
              <View style={styles.friendInfo}>
                <Text style={[styles.friendName, { color: colors.text }]} numberOfLines={1}>
                  {friend.username ? `@${friend.username}` : friend.full_name}
                </Text>
                <Text style={[styles.friendRating, { color: colors.secondary }]}>
                  ♟ {friend.rating}
                </Text>
              </View>
              <Pressable
                style={[styles.inviteBtn, { backgroundColor: colors.primary }]}
                onPress={() => handleChallengeFriend(friend)}
                disabled={challengingId === friend.id}
                accessibilityRole="button"
                accessibilityLabel={`Desafiar ${friend.username ?? friend.full_name}`}
              >
                {challengingId === friend.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.inviteBtnText}>Desafiar</Text>
                )}
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  timeControlRow: { flexDirection: "row", gap: 8 },
  timeControlPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  timeControlText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorBannerText: { fontSize: 13, flexShrink: 1, lineHeight: 18 },
  matchmakingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  matchmakingBtnText: { fontSize: 14, fontWeight: "600" },
  matchmakingBox: {
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    gap: 12,
  },
  matchmakingText: { fontSize: 13, textAlign: "center" },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1.5 },
  cancelBtnText: { fontSize: 13, fontWeight: "700" },
  emptyFriends: { fontSize: 13, fontStyle: "italic" },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarWrapper: { position: "relative" },
  avatar: {},
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontWeight: "700" },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fff",
  },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 14, fontWeight: "700" },
  friendRating: { fontSize: 12, marginTop: 2 },
  inviteBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    minWidth: 84,
    alignItems: "center",
  },
  inviteBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
