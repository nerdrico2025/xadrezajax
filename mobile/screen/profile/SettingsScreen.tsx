

import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { useBiometric } from "@/hooks/useBiometric";
import { useSoundSettings } from "@/hooks/useSoundSettings";
import { useAuth } from "@/context/AuthContext";
import { Colors } from "@/constants/theme";
import { changePassword, deleteAccount } from "@/services/profile";
import BoardThemePicker from "@/components/BoardThemePicker";

interface Props {
  onBack: () => void;
}

export default function SettingsScreen({ onBack }: Props) {
  const { theme, toggleTheme, resetToSystem, userPreference } = useTheme();
  const { isAvailable: biometricAvailable, isEnabled: biometricEnabled, enable: enableBiometric, disable: disableBiometric, authenticate } = useBiometric();
  const { soundEnabled, toggle: toggleSound } = useSoundSettings();
  const { token, signOut } = useAuth();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const isDark = theme === "dark";

  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const handleBiometricToggle = async (value: boolean) => {
    if (value) {
      const success = await authenticate();
      if (success) await enableBiometric();
    } else {
      await disableBiometric();
    }
  };

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd || !confirmPwd) {
      Alert.alert("Erro", "Preencha todos os campos.");
      return;
    }
    if (newPwd !== confirmPwd) {
      Alert.alert("Erro", "A nova senha e a confirmação não coincidem.");
      return;
    }
    if (!token) return;
    setSavingPwd(true);
    try {
      await changePassword(token, oldPwd, newPwd);
      setOldPwd(""); setNewPwd(""); setConfirmPwd("");
      setShowChangePwd(false);
      Alert.alert("Sucesso", "Senha alterada com sucesso.");
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao trocar senha.");
    } finally {
      setSavingPwd(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Excluir conta",
      "Esta ação é permanente e não pode ser desfeita. Todos os seus dados serão removidos.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Continuar",
          style: "destructive",
          onPress: () => {
            Alert.prompt(
              "Confirme sua senha",
              "Digite sua senha para confirmar a exclusão.",
              async (password) => {
                if (!password || !token) return;
                try {
                  await deleteAccount(token, password);
                  signOut();
                } catch (e: any) {
                  Alert.alert("Erro", e.message ?? "Falha ao excluir conta.");
                }
              },
              "secure-text"
            );
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.divider }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Configurações</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Aparência ─── */}
        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>Aparência</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          {/* Tema escuro */}
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name={isDark ? "moon" : "moon-outline"} size={20} color={colors.primary} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Tema escuro</Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.buttonSecondary, true: colors.accent + "88" }}
              thumbColor={isDark ? colors.accent : colors.secondary}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.divider }]} />

          {/* Seguir sistema */}
          <Pressable
            style={styles.row}
            onPress={resetToSystem}
            disabled={userPreference === null}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.secondary + "18" }]}>
              <Ionicons name="phone-portrait-outline" size={20} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: userPreference === null ? colors.secondary : colors.text }]}>
                Seguir sistema
              </Text>
              <Text style={[styles.rowSub, { color: colors.secondary }]}>
                {userPreference === null ? "Ativo" : "Toque para ativar"}
              </Text>
            </View>
            {userPreference === null && (
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            )}
          </Pressable>
        </View>

        {/* ── Tabuleiro ─── */}
        <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>Tabuleiro</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          <Text style={[styles.rowSub, { color: colors.secondary, paddingHorizontal: 16, paddingTop: 14 }]}>
            Escolha o visual do tabuleiro. Vale para todas as partidas e é
            independente do tema claro/escuro do app.
          </Text>
          <BoardThemePicker
            colors={{ text: colors.text, secondary: colors.secondary, card: colors.background, divider: colors.divider }}
          />
        </View>

        {/* ── Som ─── */}
        <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>Som</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name={soundEnabled ? "volume-high-outline" : "volume-mute-outline"} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Sons do jogo</Text>
              <Text style={[styles.rowSub, { color: colors.secondary }]}>
                {soundEnabled ? "Ativado" : "Desativado"}
              </Text>
            </View>
            <Switch
              value={soundEnabled}
              onValueChange={toggleSound}
              trackColor={{ false: colors.buttonSecondary, true: colors.accent + "88" }}
              thumbColor={soundEnabled ? colors.accent : colors.secondary}
            />
          </View>
        </View>

        {/* ── Segurança ─── */}
        {biometricAvailable && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>Segurança</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
              <View style={styles.row}>
                <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name="finger-print" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.text }]}>Biometria</Text>
                  <Text style={[styles.rowSub, { color: colors.secondary }]}>
                    {biometricEnabled ? "Ativa ao abrir o app" : "Desativada"}
                  </Text>
                </View>
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleBiometricToggle}
                  trackColor={{ false: colors.buttonSecondary, true: colors.accent + "88" }}
                  thumbColor={biometricEnabled ? colors.accent : colors.secondary}
                />
              </View>
            </View>
          </>
        )}

        {/* ── Conta ─── */}
        <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>Conta</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          <Pressable style={styles.row} onPress={() => setShowChangePwd((v) => !v)}>
            <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="key-outline" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Trocar senha</Text>
            <Ionicons name={showChangePwd ? "chevron-up" : "chevron-down"} size={18} color={colors.secondary} />
          </Pressable>

          {showChangePwd && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.divider }]} />
              <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
                <TextInput
                  style={[styles.pwdInput, { color: colors.text, borderColor: colors.divider, backgroundColor: colors.background }]}
                  placeholder="Senha atual"
                  placeholderTextColor={colors.secondary}
                  secureTextEntry
                  value={oldPwd}
                  onChangeText={setOldPwd}
                />
                <TextInput
                  style={[styles.pwdInput, { color: colors.text, borderColor: colors.divider, backgroundColor: colors.background }]}
                  placeholder="Nova senha"
                  placeholderTextColor={colors.secondary}
                  secureTextEntry
                  value={newPwd}
                  onChangeText={setNewPwd}
                />
                <TextInput
                  style={[styles.pwdInput, { color: colors.text, borderColor: colors.divider, backgroundColor: colors.background }]}
                  placeholder="Confirmar nova senha"
                  placeholderTextColor={colors.secondary}
                  secureTextEntry
                  value={confirmPwd}
                  onChangeText={setConfirmPwd}
                />
                <Pressable
                  onPress={handleChangePassword}
                  disabled={savingPwd}
                  style={[styles.pwdBtn, { backgroundColor: colors.primary, opacity: savingPwd ? 0.6 : 1 }]}
                >
                  <Text style={styles.pwdBtnText}>{savingPwd ? "Salvando..." : "Salvar"}</Text>
                </Pressable>
              </View>
            </>
          )}

          <View style={[styles.divider, { backgroundColor: colors.divider }]} />

          <Pressable style={styles.row} onPress={handleDeleteAccount}>
            <View style={[styles.rowIcon, { backgroundColor: colors.error + "18" }]}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.error }]}>Excluir conta</Text>
          </Pressable>
        </View>

        {/* ── Sobre ─── */}
        <Text style={[styles.sectionLabel, { color: colors.secondary, marginTop: 24 }]}>Sobre</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.accentMuted }]}>
              <Text style={{ fontSize: 16 }}>♟</Text>
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Clube de Xadrez AJAX</Text>
            <Text style={[styles.rowSub, { color: colors.secondary }]}>v1.0.0</Text>
          </View>
        </View>
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
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 8 },
  title: { fontSize: 17, fontWeight: "700" },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "500" },
  rowSub: { fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 64 },
  pwdInput: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14,
  },
  pwdBtn: {
    borderRadius: 10, paddingVertical: 12,
    alignItems: "center",
  },
  pwdBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
