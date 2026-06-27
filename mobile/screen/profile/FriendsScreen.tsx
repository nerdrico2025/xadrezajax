import { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { useFriends } from "@/hooks/useFriends";
import { Colors } from "@/constants/theme";
import { type Friend, type FriendRequest } from "@/services/friends";

interface Props {
  onBack: () => void;
}

type Tab = "friends" | "requests";

export default function FriendsScreen({ onBack }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();

  const { friends, pendingRequests, loading, sendRequest, acceptRequest, rejectRequest, removeFriend, refresh } = useFriends();

  const [tab, setTab] = useState<Tab>("friends");
  const [searchUsername, setSearchUsername] = useState("");
  const [sending, setSending] = useState(false);

  const handleSendRequest = useCallback(async () => {
    const username = searchUsername.trim().replace(/^@/, "");
    if (!username) return;
    setSending(true);
    try {
      await sendRequest(username);
      setSearchUsername("");
      Alert.alert("Pedido enviado!", `Solicitação enviada para @${username}.`);
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Não foi possível enviar o pedido.");
    } finally {
      setSending(false);
    }
  }, [searchUsername, sendRequest]);

  const handleRemove = useCallback((friend: Friend) => {
    Alert.alert(
      "Remover amigo",
      `Deseja remover ${friend.username ? `@${friend.username}` : friend.full_name} da sua lista?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Remover",
          style: "destructive",
          onPress: () => removeFriend(friend.friendship_id),
        },
      ]
    );
  }, [removeFriend]);

  const displayName = (item: Friend | FriendRequest) =>
    item.username ? `@${item.username}` : item.full_name;

  const renderFriend = ({ item }: { item: Friend }) => (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.divider }]}>
      <View style={styles.avatarWrap}>
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: colors.buttonSecondary }]}>
            <Ionicons name="person" size={20} color={colors.icon} />
          </View>
        )}
        <View style={[styles.onlineDot, { backgroundColor: item.is_online ? "#4CAF50" : colors.secondary }]} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
          {displayName(item)}
        </Text>
        <Text style={[styles.rowSub, { color: colors.secondary }]}>
          {item.full_name} · {item.rating} ELO
        </Text>
      </View>

      <Pressable onPress={() => handleRemove(item)} hitSlop={10} style={styles.iconBtn}>
        <Ionicons name="person-remove-outline" size={20} color={colors.secondary} />
      </Pressable>
    </View>
  );

  const renderRequest = ({ item }: { item: FriendRequest }) => (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.divider }]}>
      <View style={[styles.avatarPlaceholder, { backgroundColor: colors.buttonSecondary }]}>
        <Ionicons name="person" size={20} color={colors.icon} />
      </View>

      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
          {displayName(item)}
        </Text>
        <Text style={[styles.rowSub, { color: colors.secondary }]}>{item.full_name}</Text>
      </View>

      <Pressable
        onPress={() => acceptRequest(item.id)}
        style={[styles.actionBtn, { backgroundColor: colors.primary }]}
      >
        <Ionicons name="checkmark" size={16} color="#fff" />
      </Pressable>
      <Pressable
        onPress={() => rejectRequest(item.id)}
        style={[styles.actionBtn, { backgroundColor: colors.error + "22", marginLeft: 8 }]}
      >
        <Ionicons name="close" size={16} color={colors.error} />
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.divider }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Amigos</Text>
        <Pressable onPress={refresh} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="refresh-outline" size={22} color={colors.secondary} />
        </Pressable>
      </View>

      {/* Adicionar amigo */}
      <View style={[styles.addRow, { borderBottomColor: colors.divider }]}>
        <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          <Ionicons name="search-outline" size={18} color={colors.secondary} />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Buscar por @username"
            placeholderTextColor={colors.secondary}
            value={searchUsername}
            onChangeText={setSearchUsername}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={handleSendRequest}
          />
        </View>
        <Pressable
          onPress={handleSendRequest}
          disabled={sending || !searchUsername.trim()}
          style={[
            styles.sendBtn,
            { backgroundColor: searchUsername.trim() ? colors.primary : colors.buttonSecondary },
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="person-add-outline" size={20} color="#fff" />
          )}
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={[styles.tabs, { borderBottomColor: colors.divider }]}>
        {(["friends", "requests"] as Tab[]).map((t) => {
          const active = tab === t;
          const label = t === "friends" ? `Amigos (${friends.length})` : `Pedidos${pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ""}`;
          return (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, active && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
              <Text style={[styles.tabLabel, { color: active ? colors.primary : colors.secondary }]}>{label}</Text>
              {t === "requests" && pendingRequests.length > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.badgeText}>{pendingRequests.length}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Lista */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : tab === "friends" ? (
        <FlatList
          data={friends}
          keyExtractor={(item) => String(item.friendship_id)}
          renderItem={renderFriend}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>♟</Text>
              <Text style={[styles.emptyText, { color: colors.secondary }]}>
                Você ainda não tem amigos.{"\n"}Busque pelo @username acima!
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={pendingRequests}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderRequest}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="mail-outline" size={40} color={colors.secondary} style={{ marginBottom: 12 }} />
              <Text style={[styles.emptyText, { color: colors.secondary }]}>
                Nenhum pedido pendente.
              </Text>
            </View>
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

  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { flex: 1, fontSize: 14 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  tabLabel: { fontSize: 14, fontWeight: "600" },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },

  list: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 22 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatarWrap: { position: "relative" },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  onlineDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "transparent",
  },
  rowName: { fontSize: 14, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
  iconBtn: { padding: 6 },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
