import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/context/AuthContext";
import { Colors } from "@/constants/theme";
import { avatarUrl, type StatsBlock } from "@/services/profile";
import GameHistoryScreen from "./GameHistoryScreen";
import FriendsScreen from "./FriendsScreen";
import MenuBottomSheet from "@/presentation/components/MenuBottomSheet";

export default function ProfileScreen() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { profile, loading, saving, update, changeAvatar } = useProfile();

  const [showHistory, setShowHistory] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");

  const startEditing = useCallback(() => {
    setFullName(profile?.full_name ?? "");
    setUsername(profile?.username ?? "");
    setBio(profile?.bio ?? "");
    setIsEditing(true);
  }, [profile]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

  const saveEditing = useCallback(async () => {
    try {
      await update({ full_name: fullName, username: username || undefined, bio });
      setIsEditing(false);
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao salvar");
    }
  }, [update, fullName, username, bio]);

  const handleChangePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permissão necessária", "Precisamos de acesso à sua galeria.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      try {
        await changeAvatar(result.assets[0].uri);
      } catch {
        Alert.alert("Erro", "Falha ao enviar foto");
      }
    }
  }, [changeAvatar]);

  if (showHistory) return <GameHistoryScreen onBack={() => setShowHistory(false)} />;
  if (showFriends) return <FriendsScreen onBack={() => setShowFriends(false)} />;
  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const avatar = avatarUrl(profile?.avatar ?? null);

  return (
    <>
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header sempre visível */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        {isEditing ? (
          <Pressable onPress={cancelEditing} hitSlop={8}>
            <Text style={[styles.headerAction, { color: colors.secondary }]}>Cancelar</Text>
          </Pressable>
        ) : (
          <View style={{ width: 64 }} />
        )}

        <Text style={[styles.headerTitle, { color: colors.text }]}>Perfil</Text>

        {isEditing ? (
          <Pressable onPress={saveEditing} disabled={saving} hitSlop={8}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.headerAction, { color: colors.accentOnLight }]}>Salvar</Text>
            )}
          </Pressable>
        ) : (
          <Pressable onPress={() => setShowMenu(true)} hitSlop={12} style={styles.editIconBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        )}
      </View>

      {/* Avatar */}
      <Pressable style={styles.avatarWrapper} onPress={handleChangePhoto}>
        {avatar ? (
          <Image
            source={{ uri: avatar }}
            style={styles.avatar}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: colors.buttonSecondary }]}>
            <Ionicons name="person" size={48} color={colors.icon} />
          </View>
        )}
        <View style={[styles.cameraIcon, { backgroundColor: colors.primary }]}>
          <Ionicons name="camera" size={14} color="#fff" />
        </View>
      </Pressable>

      {/* Nome */}
      {isEditing ? (
        <TextInput
          style={[styles.nameInput, { color: colors.text, borderColor: colors.buttonSecondary }]}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Nome completo"
          placeholderTextColor={colors.secondary}
        />
      ) : (
        <Text style={[styles.name, { color: colors.text }]}>
          {profile?.full_name ?? "—"}
        </Text>
      )}

      {/* Username */}
      {isEditing ? (
        <TextInput
          style={[styles.usernameInput, { color: colors.secondary, borderColor: colors.buttonSecondary }]}
          value={username}
          onChangeText={setUsername}
          placeholder="@nome_de_usuario"
          placeholderTextColor={colors.icon}
          autoCapitalize="none"
        />
      ) : (
        <Text style={[styles.username, { color: colors.secondary }]}>
          {profile?.username ? `@${profile.username}` : "Sem username"}
        </Text>
      )}

      <Text style={[styles.email, { color: colors.icon }]}>{profile?.email}</Text>

      {/* Rating + Amigos */}
      <View style={styles.badgeRow}>
        {/* Rating = coração do produto → Dourado AJAX (R2). accentOnLight passa AA no claro. */}
        <View style={[styles.ratingBadge, { backgroundColor: colors.accentMuted }]}>
          <Text style={styles.ratingIcon}>♟</Text>
          <Text style={[styles.ratingValue, { color: colors.accentOnLight }]}>
            {profile?.rating ?? 1200}
          </Text>
          <Text style={[styles.ratingLabel, { color: colors.secondary }]}>ELO</Text>
        </View>

        <Pressable
          onPress={() => setShowFriends(true)}
          style={[styles.friendsBadge, { backgroundColor: colors.buttonSecondary + "60" }]}
        >
          <Ionicons name="people-outline" size={16} color={colors.secondary} />
          <Text style={[styles.ratingValue, { color: colors.text, fontSize: 17 }]}>
            {profile?.friends_count ?? 0}
          </Text>
          <Text style={[styles.ratingLabel, { color: colors.secondary }]}>amigos</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.secondary} />
        </Pressable>
      </View>

      {/* Estatísticas — dois blocos separados, nunca somados (decisão D2) */}
      <StatsBlockView title="Ranqueadas" stats={profile?.stats_ranked} colors={colors} />
      <StatsBlockView
        title="vs IA e Amistosas"
        stats={profile?.stats_casual}
        colors={colors}
        footnote="Partidas contra a IA entram no seu histórico, mas não alteram seu rating."
      />

      {/* Bio */}
      <View style={styles.bioSection}>
        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>Bio</Text>
        {isEditing ? (
          <TextInput
            style={[styles.bioInput, { color: colors.text, borderColor: colors.buttonSecondary }]}
            value={bio}
            onChangeText={setBio}
            placeholder="Conte algo sobre você..."
            placeholderTextColor={colors.icon}
            multiline
            maxLength={200}
          />
        ) : (
          <Text style={[styles.bioText, { color: profile?.bio ? colors.text : colors.icon }]}>
            {profile?.bio || "Nenhuma bio adicionada"}
          </Text>
        )}
      </View>

      {/* Histórico */}
      {!isEditing && (
        <View style={styles.accountSection}>
          <Text style={[styles.sectionLabel, { color: colors.secondary }]}>Atividade</Text>
          <Pressable
            style={[styles.accountRow, { backgroundColor: colors.card, borderColor: colors.divider }]}
            onPress={() => setShowHistory(true)}
          >
            <View style={[styles.accountRowIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="time-outline" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.accountRowLabel, { color: colors.text }]}>Histórico de partidas</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.secondary} />
          </Pressable>
        </View>
      )}

    </ScrollView>

      <MenuBottomSheet
        visible={showMenu}
        onClose={() => setShowMenu(false)}
        items={[
          {
            icon: <Ionicons name="create-outline" size={22} color={colors.primary} />,
            label: "Editar perfil",
            onPress: startEditing,
          },
          {
            icon: <Ionicons name="log-out-outline" size={22} color={colors.error} />,
            label: "Sair da conta",
            onPress: signOut,
          },
        ]}
      />
    </>
  );
}

function StatItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color }]}>{label}</Text>
    </View>
  );
}

function StatsBlockView({
  title,
  stats,
  colors,
  footnote,
}: {
  title: string;
  stats?: StatsBlock;
  colors: Record<string, string>;
  footnote?: string;
}) {
  const s = stats ?? { wins: 0, losses: 0, draws: 0, total: 0 };
  return (
    <View style={styles.statsBlock}>
      {/* Título do bloco em dourado (decisão D3 / regra 6 do PR F) */}
      <Text style={[styles.blockTitle, { color: colors.accent }]}>{title}</Text>
      <View style={[styles.statsCard, { backgroundColor: colors.buttonSecondary + "40" }]}>
        <StatItem label="Partidas" value={s.total} color={colors.text} />
        <View style={[styles.statDivider, { backgroundColor: colors.buttonSecondary }]} />
        <StatItem label="Vitórias" value={s.wins} color="#4CAF50" />
        <View style={[styles.statDivider, { backgroundColor: colors.buttonSecondary }]} />
        <StatItem label="Empates" value={s.draws} color={colors.secondary} />
        <View style={[styles.statDivider, { backgroundColor: colors.buttonSecondary }]} />
        <StatItem label="Derrotas" value={s.losses} color={colors.error} />
      </View>
      {footnote ? (
        <Text style={[styles.blockFootnote, { color: colors.secondary }]}>{footnote}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { alignItems: "center", paddingTop: 12, paddingHorizontal: 20 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerAction: { fontSize: 15, fontWeight: "600", width: 64, textAlign: "center" },
  editIconBtn: { width: 64, alignItems: "flex-end", paddingRight: 4 },
  avatarWrapper: { position: "relative", marginBottom: 12 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: "center", justifyContent: "center",
  },
  cameraIcon: {
    position: "absolute", bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  name: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  nameInput: {
    fontSize: 20, fontWeight: "600", width: "100%",
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 8, marginBottom: 6, textAlign: "center",
  },
  username: { fontSize: 14, marginBottom: 2 },
  usernameInput: {
    fontSize: 14, width: "100%", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 4, textAlign: "center",
  },
  email: { fontSize: 13, marginBottom: 16 },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  ratingBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  friendsBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  ratingIcon: { fontSize: 18 },
  ratingValue: { fontSize: 20, fontWeight: "700" },
  ratingLabel: { fontSize: 13, fontWeight: "500" },
  statsBlock: { width: "100%", marginBottom: 16 },
  blockTitle: {
    fontSize: 12, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 0.8, marginBottom: 8,
  },
  blockFootnote: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  statsCard: {
    flexDirection: "row", width: "100%", borderRadius: 16,
    paddingVertical: 16,
  },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 20, fontWeight: "700" },
  statLabel: { fontSize: 11, fontWeight: "500", opacity: 0.8 },
  statDivider: { width: 1, marginVertical: 4 },
  bioSection: { width: "100%", marginBottom: 24 },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  bioText: { fontSize: 14, lineHeight: 20 },
  bioInput: {
    fontSize: 14, lineHeight: 20, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, minHeight: 80, textAlignVertical: "top",
  },
  accountSection: { width: "100%", marginTop: 8 },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  accountRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  accountRowLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
});
