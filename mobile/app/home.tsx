import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import TopBar from "@/components/TopBar";
import BottomBar, { type BottomTab } from "@/components/BottomBar";
import OfflineBanner from "@/components/OfflineBanner";
import type { ColorChoice, Difficulty, PlayerColor } from "@/constants/aiGame";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useGameSocket } from "@/hooks/useGameSocket";
import { useAuth } from "@/context/AuthContext";
import { useFriends } from "@/hooks/useFriends";
import { loadSavedGame, clearSavedGame, type SavedAiGame } from "@/utils/savedGame";
import { checkAiGameAllowed } from "@/utils/preGameGate";
import {
  loadAiSetupPrefs,
  saveAiSetupPrefs,
  type AiSetupPrefs,
} from "@/utils/aiSetupPrefs";

import HomeScreen from "@/screen/home/HomeScreen";
import GameScreen from "@/screen/game/GameScreen";
import AiGameSetupScreen from "@/screen/game/AiGameSetupScreen";
import PuzzleScreen from "@/screen/puzzles/PuzzleScreen";
import OnlineGameScreen from "@/screen/game/OnlineGameScreen";
import ProfileScreen from "@/screen/profile/ProfileScreen";
import SettingsScreen from "@/screen/profile/SettingsScreen";
import LeaderboardScreen from "@/screen/home/LeaderboardScreen";
import SubscriptionScreen from "@/screen/home/SubscriptionScreen";
import MatchmakingScreen from "@/screen/online/MatchmakingScreen";
import MenuBottomSheet from "@/presentation/components/MenuBottomSheet";
import { gameMenu, profileMenu } from "@/presentation/config/menuConfigs";

type ActiveMenu = "game" | "profile" | null;
type ActiveScreen = "home" | "ai_setup" | "play" | "puzzles" | "private_room" | "profile" | "settings" | "leaderboard" | "subscription";

export default function Home() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { user, token } = useAuth();
  const { pendingRequests } = useFriends();

  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>("home");
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [quickSearching, setQuickSearching] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [playerColor, setPlayerColor] = useState<PlayerColor>("w");
  const [timeControl, setTimeControl] = useState<number | null>(300);
  const [increment, setIncrement] = useState(0);
  const [aiSetupInitial, setAiSetupInitial] = useState<AiSetupPrefs | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [savedGame, setSavedGame] = useState<SavedAiGame | null>(null);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [pendingSavedGame, setPendingSavedGame] = useState<SavedAiGame | null>(null);

  const {
    status: socketStatus,
    game: onlineGame,
    error: socketError,
    errorCode: socketErrorCode,
    roomCode,
    opponentDisconnected,
    friendInvitation,
    joinQueue,
    leaveQueue,
    createRoom,
    joinRoom,
    makeMove,
    resign,
    offerDraw,
    acceptDraw,
    declineDraw,
    incomingDrawOffer,
    outgoingDrawOffer,
    drawOfferDeclined,
    clearGame,
    inviteFriend,
    dismissInvitation,
  } = useGameSocket();

  useEffect(() => {
    if (quickSearching && (socketStatus === "error" || socketStatus === "idle") && !onlineGame) {
      setQuickSearching(false);
    }
  }, [socketStatus, quickSearching, onlineGame]);

  const showDailyLimitAlert = useCallback(() => {
    Alert.alert(
      "Limite diário atingido",
      "Você já jogou as 5 partidas de hoje do plano Grátis. Assine o Premium para jogar sem limites — partidas sem relógio continuam liberadas.",
      [
        { text: "Agora não", style: "cancel" },
        {
          text: "Ver planos",
          onPress: () => {
            setActiveScreen("subscription");
            setActiveMenu(null);
          },
        },
      ]
    );
  }, []);

  // Gating online (RF-MON-05): o node-api recusa a entrada na fila antes do
  // pareamento e envia code daily_limit_reached — mapeia p/ tela de upgrade
  useEffect(() => {
    if (socketStatus === "error" && socketErrorCode === "daily_limit_reached") {
      setQuickSearching(false);
      showDailyLimitAlert();
    }
  }, [socketStatus, socketErrorCode, showDailyLimitAlert]);

  useEffect(() => {
    if (!friendInvitation) return;
    const { fromName, roomCode: inviteCode } = friendInvitation;
    Alert.alert(
      "Convite de partida ♟",
      `${fromName} te convidou para jogar!`,
      [
        { text: "Recusar", onPress: dismissInvitation, style: "cancel" },
        {
          text: "Aceitar",
          onPress: () => {
            dismissInvitation();
            joinRoom(inviteCode);
          },
        },
      ],
      { cancelable: false }
    );
  }, [friendInvitation]);

  const handleCloseMenu = useCallback(() => setActiveMenu(null), []);

  const handleTabPress = useCallback((tab: BottomTab) => {
    setActiveTab(tab);
    if (tab === "play") {
      setActiveMenu("game");
    } else if (tab === "profile") {
      setActiveMenu("profile");
    } else {
      setActiveMenu(null);
      setActiveScreen("home");
    }
  }, []);

  const ONLINE_TIME_CONTROL = 5 * 60; // 5 minutos fixo para partidas online

  const handleQuickOnline = useCallback(() => {
    setActiveMenu(null);
    setQuickSearching(true);
    joinQueue(ONLINE_TIME_CONTROL, { username: user?.username, rating: user?.rating });
  }, [joinQueue, user]);

  const openAiSetup = useCallback(async () => {
    // Pré-seleciona a última configuração usada (PR C).
    const prefs = await loadAiSetupPrefs();
    setAiSetupInitial(prefs);
    setActiveScreen("ai_setup");
  }, []);

  const handleStartAI = useCallback(async () => {
    setActiveMenu(null);
    const saved = await loadSavedGame();
    if (saved) {
      setPendingSavedGame(saved);
      setShowContinueModal(true);
    } else {
      await openAiSetup();
    }
  }, [openAiSetup]);

  const handleCancelQuickSearch = useCallback(() => {
    leaveQueue();
    setQuickSearching(false);
  }, [leaveQueue]);

  const handleStartConfiguredGame = useCallback(
    async (config: {
      difficulty: Difficulty;
      playerColor: PlayerColor;
      color: ColorChoice;
      timeControl: { id: string; base: number | null; increment: number };
    }) => {
      // Gating pré-jogo vs IA (RF-MON-05): bloqueia ANTES de o tabuleiro
      // abrir. Partidas sem relógio são não-rateadas e passam direto.
      const gate = await checkAiGameAllowed(token, config.timeControl.base);
      if (!gate.allowed) {
        showDailyLimitAlert();
        return;
      }
      // Persiste a última configuração para pré-selecionar na próxima vez.
      saveAiSetupPrefs({
        difficulty: config.difficulty,
        color: config.color,
        timeId: config.timeControl.id,
      });
      setDifficulty(config.difficulty);
      setPlayerColor(config.playerColor);
      setTimeControl(config.timeControl.base);
      setIncrement(config.timeControl.increment);
      setSavedGame(null);
      setActiveScreen("play");
      setGameKey((k) => k + 1);
    },
    [token, showDailyLimitAlert]
  );

  const handleLeaveOnline = useCallback(() => {
    clearGame();
    setActiveScreen("home");
    setActiveTab("home");
  }, [clearGame]);

  const handleInviteFriend = useCallback(
    (friendId: number) => {
      inviteFriend(friendId, { username: user?.username ?? undefined, full_name: user?.full_name });
    },
    [inviteFriend, user]
  );


  const currentMenu = (() => {
    if (activeMenu === "game")
      return gameMenu({
        onQuickMatch: handleStartAI,
        onQuickOnline: handleQuickOnline,
        onPrivateRoom: () => {
          setActiveScreen("private_room");
          setActiveMenu(null);
        },
      });
    if (activeMenu === "profile")
      return profileMenu({
        onProfile:      () => { setActiveMenu(null); setActiveScreen("profile"); },
        onLeaderboard:  () => { setActiveMenu(null); setActiveScreen("leaderboard"); },
        onSubscription: () => { setActiveMenu(null); setActiveScreen("subscription"); },
        onSettings:     () => { setActiveMenu(null); setActiveScreen("settings"); },
      });
    return null;
  })();

  const showOnlineGame = !!onlineGame;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TopBar />
      <OfflineBanner />

      <View style={styles.content}>
        {showOnlineGame ? (
          <OnlineGameScreen
            game={onlineGame}
            opponentDisconnected={opponentDisconnected}
            moveError={socketError}
            isReconnecting={socketStatus === "reconnecting"}
            incomingDrawOffer={incomingDrawOffer}
            outgoingDrawOffer={outgoingDrawOffer}
            drawOfferDeclined={drawOfferDeclined}
            onMakeMove={makeMove}
            onResign={resign}
            onOfferDraw={offerDraw}
            onAcceptDraw={acceptDraw}
            onDeclineDraw={declineDraw}
            onLeave={handleLeaveOnline}
          />
        ) : activeScreen === "home" ? (
          <HomeScreen
            onPlayAI={handleStartAI}
            onPlayOnline={handleQuickOnline}
            onPrivateRoom={() => { setActiveScreen("private_room"); }}
            onPlayPuzzles={() => { setActiveScreen("puzzles"); }}
          />
        ) : activeScreen === "ai_setup" ? (
          <AiGameSetupScreen
            initial={aiSetupInitial}
            onStart={handleStartConfiguredGame}
            onBack={() => { setActiveScreen("home"); setActiveTab("home"); }}
          />
        ) : activeScreen === "play" ? (
          <View style={styles.gameContainer}>
            <GameScreen
              key={gameKey}
              difficulty={difficulty}
              playerColor={playerColor}
              timeControl={timeControl}
              increment={increment}
              savedGame={savedGame ?? undefined}
              onLeave={() => setActiveScreen("home")}
            />
          </View>
        ) : activeScreen === "puzzles" ? (
          <PuzzleScreen
            onBack={() => {
              setActiveScreen("home");
              setActiveTab("home");
            }}
            onUpgrade={() => setActiveScreen("subscription")}
          />
        ) : activeScreen === "private_room" ? (
          <MatchmakingScreen
            status={socketStatus}
            roomCode={roomCode}
            onJoinQueue={joinQueue}
            onLeaveQueue={leaveQueue}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            onInviteFriend={handleInviteFriend}
            initialTab="friend"
            onBack={() => {
              leaveQueue();
              setActiveScreen("home");
              setActiveTab("home");
            }}
          />
        ) : activeScreen === "profile" ? (
          <ProfileScreen />
        ) : activeScreen === "settings" ? (
          <SettingsScreen onBack={() => setActiveScreen("home")} />
        ) : activeScreen === "leaderboard" ? (
          <LeaderboardScreen onBack={() => setActiveScreen("home")} />
        ) : activeScreen === "subscription" ? (
          <SubscriptionScreen onBack={() => setActiveScreen("home")} />
        ) : null}
      </View>

      {!showOnlineGame && (
        <BottomBar activeTab={activeTab} onTabPress={handleTabPress} pendingFriendRequests={pendingRequests.length} />
      )}

      {currentMenu && (
        <MenuBottomSheet
          visible={activeMenu !== null}
          title={currentMenu.title}
          items={currentMenu.items}
          onClose={handleCloseMenu}
        />
      )}

      <Modal
        visible={showContinueModal}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.overlayTitle, { color: colors.text }]}>Partida salva ♟</Text>
            <Text style={[styles.overlaySubtitle, { color: colors.secondary }]}>
              Você tem uma partida em andamento. Deseja continuar de onde parou?
            </Text>
            <Pressable
              style={[styles.continueButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (pendingSavedGame) {
                  setDifficulty(pendingSavedGame.difficulty);
                  setPlayerColor(pendingSavedGame.playerColor);
                  setTimeControl(null);
                  setSavedGame(pendingSavedGame);
                  setPendingSavedGame(null);
                  setGameKey((k) => k + 1);
                  setActiveScreen("play");
                }
                setShowContinueModal(false);
              }}
            >
              <Text style={styles.continueButtonText}>Continuar</Text>
            </Pressable>
            <Pressable
              style={[styles.cancelButton, { borderColor: colors.error }]}
              onPress={() => {
                clearSavedGame().catch(() => {});
                setPendingSavedGame(null);
                setShowContinueModal(false);
                openAiSetup();
              }}
            >
              <Text style={[styles.cancelText, { color: colors.error }]}>Novo jogo</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={quickSearching && !showOnlineGame}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, { backgroundColor: colors.background }]}>
            <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
            <Text style={[styles.overlayTitle, { color: colors.text }]}>
              Procurando oponente...
            </Text>
            <Text style={[styles.overlaySubtitle, { color: colors.secondary }]}>
              Aguarde enquanto encontramos um adversário
            </Text>
            <Pressable
              style={[styles.cancelButton, { borderColor: colors.error }]}
              onPress={handleCancelQuickSearch}
            >
              <Text style={[styles.cancelText, { color: colors.error }]}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  gameContainer: { flex: 1 },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  overlayCard: {
    width: "100%",
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  spinner: { marginBottom: 24 },
  overlayTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  overlaySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 32,
  },
  continueButton: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  continueButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  cancelText: { fontSize: 15, fontWeight: "600" },
});
