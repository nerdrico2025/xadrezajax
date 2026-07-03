import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useState, useCallback } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import type { SocketStatus } from "@/hooks/useGameSocket";
import { useFriends } from "@/hooks/useFriends";
import type { Friend, FriendRequest } from "@/services/friends";

interface Props {
  status: SocketStatus;
  roomCode: string | null;
  onJoinQueue: () => void;
  onLeaveQueue: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onBack: () => void;
  onInviteFriend: (friendId: number) => void;
  initialTab?: "friend" | "code";
}

type Tab = "friend" | "code";

export default function MatchmakingScreen({
  status,
  roomCode,
  onLeaveQueue,
  onJoinRoom,
  onBack,
  onInviteFriend,
  initialTab = "friend",
}: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [invitedFriendName, setInvitedFriendName] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);

  const {
    friends,
    pendingRequests,
    loading: friendsLoading,
    refresh: refreshFriends,
    sendRequest,
    acceptRequest,
    rejectRequest,
  } = useFriends();

  const isConnected = status === "connected" || status === "queued" || status === "in_game";
  const isConnecting = status === "connecting" || status === "idle";

  const handleJoinRoom = () => {
    const code = roomCodeInput.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert("Código inválido", "O código deve ter 6 caracteres.");
      return;
    }
    onJoinRoom(code);
  };

  const handleInvite = useCallback(
    (friend: Friend) => {
      setInvitedFriendName(friend.username ? `@${friend.username}` : friend.full_name);
      onInviteFriend(friend.id);
    },
    [onInviteFriend]
  );

  const handleAddFriend = useCallback(async () => {
    const username = addUsername.trim();
    if (!username) return;
    setAddLoading(true);
    setAddError(null);
    try {
      await sendRequest(username);
      setAddUsername("");
      Alert.alert("Pedido enviado!", `Pedido de amizade enviado para @${username}`);
    } catch (e: any) {
      setAddError(e.message ?? "Erro ao enviar pedido");
    } finally {
      setAddLoading(false);
    }
  }, [addUsername, sendRequest]);

  const handleAccept = useCallback(
    async (id: number) => {
      try {
        await acceptRequest(id);
      } catch {
        Alert.alert("Erro", "Não foi possível aceitar o pedido.");
      }
    },
    [acceptRequest]
  );

  const handleReject = useCallback(
    async (id: number) => {
      try {
        await rejectRequest(id);
      } catch {
        Alert.alert("Erro", "Não foi possível recusar o pedido.");
      }
    },
    [rejectRequest]
  );

  const getInitial = (name: string | null | undefined) =>
    (name ?? "?")[0].toUpperCase();

  const renderAvatar = (
    avatar: string | null,
    name: string | null | undefined,
    size = 44
  ) => {
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

  const renderFriendRow = (friend: Friend) => (
    <View
      key={friend.id}
      style={[styles.friendRow, { borderBottomColor: colors.buttonSecondary + "50" }]}
    >
      <View style={styles.avatarWrapper}>
        {renderAvatar(friend.avatar, friend.username ?? friend.full_name)}
        <View
          style={[
            styles.onlineDot,
            { backgroundColor: friend.is_online ? "#22c55e" : "#6b7280" },
          ]}
        />
      </View>
      <View style={styles.friendInfo}>
        <Text style={[styles.friendName, { color: colors.text }]} numberOfLines={1}>
          {friend.username ? `@${friend.username}` : friend.full_name}
        </Text>
        <Text style={[styles.friendRating, { color: colors.secondary }]}>♟ {friend.rating}</Text>
      </View>
      {friend.is_online && (
        <Pressable
          style={[styles.inviteBtn, { backgroundColor: colors.primary }]}
          onPress={() => handleInvite(friend)}
        >
          <Text style={styles.inviteBtnText}>Convidar</Text>
        </Pressable>
      )}
    </View>
  );

  const renderPendingRow = (req: FriendRequest) => (
    <View
      key={req.id}
      style={[styles.friendRow, { borderBottomColor: colors.buttonSecondary + "50" }]}
    >
      <View style={styles.avatarWrapper}>
        {renderAvatar(req.avatar, req.username ?? req.full_name)}
      </View>
      <View style={styles.friendInfo}>
        <Text style={[styles.friendName, { color: colors.text }]} numberOfLines={1}>
          {req.username ? `@${req.username}` : req.full_name}
        </Text>
        <Text style={[styles.pendingLabel, { color: colors.secondary }]}>quer ser seu amigo</Text>
      </View>
      <View style={styles.pendingActions}>
        <Pressable
          style={[styles.actionBtn, { backgroundColor: "#22c55e" }]}
          onPress={() => handleAccept(req.id)}
        >
          <Ionicons name="checkmark" size={16} color="#fff" />
        </Pressable>
        <Pressable
          style={[styles.actionBtn, { backgroundColor: colors.buttonSecondary }]}
          onPress={() => handleReject(req.id)}
        >
          <Ionicons name="close" size={16} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.buttonSecondary }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Jogar com Amigos</Text>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isConnected ? "#22c55e" : isConnecting ? "#f59e0b" : "#ef4444" },
          ]}
        />
      </View>

      {/* Tabs */}
      <View style={[styles.tabs, { borderBottomColor: colors.buttonSecondary }]}>
        {(["friend", "code"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            style={[
              styles.tab,
              tab === t && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
            ]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, { color: tab === t ? colors.primary : colors.secondary }]}>
              {t === "friend" ? "Amigo" : "Código"}
              {t === "friend" && pendingRequests.length > 0
                ? ` (${pendingRequests.length})`
                : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── ABA AMIGO ── */}
      {tab === "friend" && (
        roomCode ? (
          // Waiting for invited friend to join
          <View style={[styles.content, styles.roomCodeDisplay]}>
            <Ionicons name="people" size={48} color={colors.primary} style={{ marginBottom: 20 }} />
            <Text style={[styles.roomCodeLabel, { color: colors.secondary }]}>Código da sala</Text>
            <View style={[styles.codeBox, { backgroundColor: colors.buttonSecondary + "40" }]}>
              <Text style={[styles.codeText, { color: colors.primary }]}>{roomCode}</Text>
            </View>
            {invitedFriendName ? (
              <Text style={[styles.codeHint, { color: colors.secondary }]}>
                Convite enviado para {invitedFriendName}
              </Text>
            ) : (
              <Text style={[styles.codeHint, { color: colors.secondary }]}>
                Compartilhe este código com seu amigo
              </Text>
            )}
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
            <Text style={[styles.waitingText, { color: colors.secondary }]}>
              Aguardando oponente entrar...
            </Text>
            <Pressable
              style={[styles.cancelButton, { borderColor: colors.error, marginTop: 24 }]}
              onPress={() => {
                setInvitedFriendName(null);
                onLeaveQueue();
              }}
            >
              <Text style={[styles.cancelButtonText, { color: colors.error }]}>Cancelar</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            style={styles.content}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={friendsLoading}
                onRefresh={refreshFriends}
                tintColor={colors.primary}
              />
            }
          >
            {/* Add friend */}
            <View style={styles.addRow}>
              <TextInput
                style={[
                  styles.addInput,
                  { color: colors.text, borderColor: colors.buttonSecondary, backgroundColor: colors.buttonSecondary + "30" },
                ]}
                placeholder="Adicionar por username"
                placeholderTextColor={colors.icon}
                value={addUsername}
                onChangeText={setAddUsername}
                autoCapitalize="none"
                returnKeyType="send"
                onSubmitEditing={handleAddFriend}
              />
              <Pressable
                style={[
                  styles.addBtn,
                  { backgroundColor: addUsername.trim() ? colors.primary : colors.buttonSecondary },
                ]}
                onPress={handleAddFriend}
                disabled={!addUsername.trim() || addLoading}
              >
                {addLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="person-add" size={18} color="#fff" />
                )}
              </Pressable>
            </View>
            {addError && (
              <Text style={[styles.addError, { color: colors.error }]}>{addError}</Text>
            )}

            {/* Pending requests */}
            {pendingRequests.length > 0 && (
              <View style={[styles.section, { borderColor: colors.buttonSecondary + "60" }]}>
                <Pressable
                  style={styles.sectionHeader}
                  onPress={() => setShowPending(!showPending)}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Pedidos recebidos
                  </Text>
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.badgeText}>{pendingRequests.length}</Text>
                  </View>
                  <Ionicons
                    name={showPending ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.secondary}
                    style={{ marginLeft: 4 }}
                  />
                </Pressable>
                {showPending && pendingRequests.map(renderPendingRow)}
              </View>
            )}

            {/* Friends list */}
            <View style={[styles.section, { borderColor: colors.buttonSecondary + "60" }]}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Amigos{friends.length > 0 ? ` (${friends.length})` : ""}
                </Text>
              </View>

              {friendsLoading && friends.length === 0 ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
              ) : friends.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={44} color={colors.secondary} />
                  <Text style={[styles.emptyText, { color: colors.secondary }]}>
                    Você ainda não tem amigos.{"\n"}Adicione alguém pelo username!
                  </Text>
                </View>
              ) : (
                friends.map(renderFriendRow)
              )}
            </View>
          </ScrollView>
        )
      )}

      {/* ── ABA CÓDIGO ── */}
      {tab === "code" && (
        <View style={[styles.content, styles.centered, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
            <Ionicons name="key-outline" size={48} color={colors.primary} />
          </View>
          <Text style={[styles.optionTitle, { color: colors.text }]}>Entrar com código</Text>
          <Text style={[styles.optionDesc, { color: colors.secondary }]}>
            Digite o código de 6 caracteres que seu amigo compartilhou
          </Text>
          <TextInput
            style={[
              styles.codeInput,
              {
                color: colors.text,
                borderColor: colors.buttonSecondary,
                backgroundColor: colors.buttonSecondary + "30",
              },
            ]}
            value={roomCodeInput}
            onChangeText={(t) => setRoomCodeInput(t.toUpperCase().slice(0, 6))}
            placeholder="XXXXXX"
            placeholderTextColor={colors.icon}
            autoCapitalize="characters"
            maxLength={6}
          />
          <Pressable
            style={[
              styles.primaryButton,
              { backgroundColor: roomCodeInput.length === 6 ? colors.primary : colors.buttonSecondary },
            ]}
            onPress={handleJoinRoom}
            disabled={roomCodeInput.length !== 6}
          >
            <Ionicons name="enter-outline" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Entrar</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const AVATAR_SIZE = 44;

const styles = StyleSheet.create({
  container: { flex: 1 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 14, fontWeight: "600" },
  content: { flex: 1 },
  scrollContent: { padding: 16 },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },

  // Add friend row
  addRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  addInput: {
    flex: 1,
    height: 44,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addError: { fontSize: 12, marginBottom: 8 },

  // Section
  section: {
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  sectionTitle: { fontSize: 14, fontWeight: "700", flex: 1 },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  // Friend / Pending row
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  avatarWrapper: { position: "relative" },
  avatar: { resizeMode: "cover" },
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
  friendName: { fontSize: 14, fontWeight: "600" },
  friendRating: { fontSize: 12, marginTop: 2 },
  pendingLabel: { fontSize: 12, marginTop: 2 },
  inviteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  inviteBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  pendingActions: { flexDirection: "row", gap: 6 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  // Empty state
  emptyState: { alignItems: "center", paddingVertical: 32, gap: 12 },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 20 },

  // Code tab
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  optionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  optionDesc: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: "100%",
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  codeInput: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 6,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderRadius: 12,
    width: "100%",
    marginBottom: 16,
  },

  // Waiting state (room code)
  roomCodeDisplay: { flex: 1, alignItems: "center", justifyContent: "center" },
  roomCodeLabel: {
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  codeBox: { paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, marginBottom: 8 },
  codeText: { fontSize: 36, fontWeight: "900", letterSpacing: 6 },
  codeHint: { fontSize: 13 },
  waitingText: { fontSize: 14, marginTop: 8 },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  cancelButtonText: { fontSize: 15, fontWeight: "600" },
});
