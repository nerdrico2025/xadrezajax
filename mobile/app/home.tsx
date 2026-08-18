import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useGameSocket, type HostGameSetup } from "@/hooks/useGameSocket";
import { useAuth } from "@/context/AuthContext";
import { useFriends } from "@/hooks/useFriends";
import { usePushPermission } from "@/hooks/usePushPermission";
import { loadSavedGame, clearSavedGame, type SavedAiGame } from "@/utils/savedGame";
import { checkAiGameAllowed } from "@/utils/preGameGate";
import {
  loadAiSetupPrefs,
  saveAiSetupPrefs,
  type AiSetupPrefs,
} from "@/utils/aiSetupPrefs";
import { getOnlineTimePref, loadOnlineTimePref } from "@/utils/onlinePrefs";
import { humanTimeLabel } from "@/constants/onlineGame";

import HomeScreen from "@/screen/home/HomeScreen";
import GameScreen from "@/screen/game/GameScreen";
import AiGameSetupScreen from "@/screen/game/AiGameSetupScreen";
import CampaignMapScreen from "@/screen/game/CampaignMapScreen";
import PuzzleScreen from "@/screen/puzzles/PuzzleScreen";
import OnlineGameScreen from "@/screen/game/OnlineGameScreen";
import ProfileScreen from "@/screen/profile/ProfileScreen";
import SettingsScreen from "@/screen/profile/SettingsScreen";
import LeaderboardScreen from "@/screen/home/LeaderboardScreen";
import SubscriptionScreen from "@/screen/home/SubscriptionScreen";
import MatchmakingScreen from "@/screen/online/MatchmakingScreen";
import CorrespondenceListScreen from "@/screen/game/CorrespondenceListScreen";
import CorrespondenceChallengeScreen from "@/screen/game/CorrespondenceChallengeScreen";
import CorrespondenceGameScreen from "@/screen/game/CorrespondenceGameScreen";
import type { CorrespondenceGame } from "@/services/correspondence";
import MenuBottomSheet from "@/presentation/components/MenuBottomSheet";
import { gameMenu, profileMenu } from "@/presentation/config/menuConfigs";

type ActiveMenu = "game" | "profile" | null;
type ActiveScreen = "home" | "campaign_map" | "ai_setup" | "play" | "puzzles" | "puzzle_training" | "private_room" | "profile" | "settings" | "leaderboard" | "subscription" | "correspondence_list" | "correspondence_challenge" | "correspondence_game";

export default function Home() {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { user, token } = useAuth();
  const { pendingRequests } = useFriends();
  const { requestAndRegister } = usePushPermission();

  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>("home");
  // Nível escolhido no Mapa da Campanha. Presente = o wizard abre travado
  // nele e pula a escolha de dificuldade; null = entrada direta pelo wizard.
  const [lockedLevel, setLockedLevel] = useState<Difficulty | null>(null);
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
  const [correspondenceGame, setCorrespondenceGame] = useState<CorrespondenceGame | null>(null);

  const {
    status: socketStatus,
    game: onlineGame,
    error: socketError,
    errorCode: socketErrorCode,
    errorSeq: socketErrorSeq,
    roomCode,
    opponentDisconnected,
    friendInvitation,
    joinQueue,
    leaveQueue,
    createRoom,
    joinRoom,
    closeRoom,
    makeMove,
    resign,
    offerDraw,
    acceptDraw,
    declineDraw,
    incomingDrawOffer,
    outgoingDrawOffer,
    drawOfferDeclined,
    ratingOutcome,
    gamePublicId,
    onlineFriendIds,
    watchPresence,
    clearGame,
    inviteFriend,
    dismissInvitation,
  } = useGameSocket();

  // Identidade anunciada ao oponente (topo da tela de jogo dele). A fila
  // rápida já mandava; sala/convite passam a mandar o mesmo objeto.
  const playerMeta = useMemo(
    () => ({
      username: user?.username,
      full_name: user?.full_name,
      rating: user?.rating,
    }),
    [user]
  );

  // Carrega a preferência de tempo cedo, para a busca rápida poder lê-la de
  // forma síncrona no toque do botão (ver handleQuickOnline).
  useEffect(() => {
    loadOnlineTimePref();
  }, []);

  useEffect(() => {
    if (quickSearching && (socketStatus === "error" || socketStatus === "idle") && !onlineGame) {
      setQuickSearching(false);
    }
  }, [socketStatus, quickSearching, onlineGame]);

  // A busca ACABOU quando a partida começa. Sem isto o overlay volta a
  // aparecer ao sair da partida: clearGame() devolve status "connected", que
  // não é "error" nem "idle", então o reset acima nunca dispara e a tela fica
  // travada em "Procurando oponente...".
  useEffect(() => {
    if (onlineGame) setQuickSearching(false);
  }, [onlineGame]);

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
    const { fromName, roomCode: inviteCode, timeControl, yourColor } =
      friendInvitation;
    // Cor e tempo já foram decididos pelo anfitrião (item 5) — o convite
    // informa, não pergunta. Quem recebe só aceita ou recusa.
    const detalhes = [
      timeControl ? humanTimeLabel(timeControl) : null,
      yourColor === "w" ? "você joga de brancas" : yourColor === "b" ? "você joga de pretas" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    Alert.alert(
      "Convite de partida ♟",
      `${fromName} te convidou para jogar!` + (detalhes ? `\n${detalhes}` : ""),
      [
        {
          // RECUSAR é teardown de verdade: invalida a sala e avisa quem
          // convidou (antes só sumia o alerta e o convidante esperava
          // indefinidamente por alguém que já tinha recusado).
          text: "Recusar",
          onPress: () => {
            closeRoom(inviteCode);
            dismissInvitation();
          },
          style: "cancel",
        },
        {
          text: "Aceitar",
          onPress: () => {
            dismissInvitation();
            joinRoom(inviteCode, playerMeta);
          },
        },
      ],
      { cancelable: false }
    );
    // Dep list estreita de propósito: o alerta é um efeito colateral por
    // CONVITE. Incluir playerMeta/callbacks faria o mesmo convite reabrir o
    // alerta a cada mudança de perfil ou reconexão do socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Busca rápida: UM TOQUE, sem tela de configuração (item 6). O tempo sai da
  // preferência salva em Ajustes; a cor é decidida pelo servidor, balanceada
  // pelo histórico do par; e a partida é sempre ranqueada — não há toggle
  // para nada disso.
  //
  // A preferência é lida do cache do módulo (`getOnlineTimePref`), não de
  // estado do React: sem await no caminho do botão, o toque continua sendo um
  // toque. `loadOnlineTimePref` roda no mount da tela, muito antes.
  const handleQuickOnline = useCallback(() => {
    setActiveMenu(null);
    setQuickSearching(true);
    joinQueue(getOnlineTimePref(), playerMeta);
  }, [joinQueue, playerMeta]);

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
      return;
    }
    // O ponto de entrada agora é o MAPA, não o wizard: escolher o nível é
    // justamente o que o mapa faz, e melhor do que uma lista.
    setLockedLevel(null);
    setActiveScreen("campaign_map");
  }, []);

  /** Toque num nó do mapa: abre o wizard já travado naquele nível. */
  const handlePlayCampaignLevel = useCallback(async (level: Difficulty) => {
    const prefs = await loadAiSetupPrefs();
    setAiSetupInitial(prefs);
    setLockedLevel(level);
    setActiveScreen("ai_setup");
  }, []);

  // Ponto de entrada do Modo Turno. `requestAndRegister` é o gatilho de
  // permissão de push que ficou pendente desde a Fase A (fundação) — sem
  // tela que a chamasse, o hook nunca era usado. Chamar aqui é seguro em
  // toda entrada, não só a primeira: o hook não reabre o diálogo do SO se a
  // permissão já foi decidida, e re-registrar um token já ativo é no-op no
  // servidor (ver usePushPermission).
  const handleOpenCorrespondence = useCallback(() => {
    requestAndRegister();
    setActiveScreen("correspondence_list");
  }, [requestAndRegister]);

  const handleOpenCorrespondenceGame = useCallback((game: CorrespondenceGame) => {
    setCorrespondenceGame(game);
    setActiveScreen("correspondence_game");
  }, []);

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

  const handleUpgrade = useCallback(() => {
    setActiveMenu(null);
    setActiveScreen("subscription");
  }, []);

  /**
   * "Assinar Premium" no modal de fim de partida ONLINE.
   *
   * Precisa existir separado: no render abaixo, `showOnlineGame` vem ANTES da
   * cadeia de `activeScreen` — enquanto houver partida online em memória, é
   * OnlineGameScreen que ocupa a tela, aconteça o que acontecer com
   * `activeScreen`. Era esse o bug: o botão chamava `setActiveScreen`, o
   * estado mudava, e nada acontecia na tela — o modal seguia aberto sobre a
   * partida, e o botão parecia sem ação.
   *
   * `clearGame()` é o que libera a árvore. A partida já acabou (o modal só
   * existe depois do fim), então não há nada a perder — é o mesmo caminho do
   * "Voltar" ao lado.
   */
  const handleUpgradeFromOnlineGame = useCallback(() => {
    clearGame();
    setActiveTab("home");
    handleUpgrade();
  }, [clearGame, handleUpgrade]);

  // `setup` = cor e tempo que o anfitrião escolheu na tela de convite. O
  // servidor valida os dois antes de gravar a sala.
  const handleInviteFriend = useCallback(
    (friendId: number, setup: HostGameSetup) => {
      inviteFriend(friendId, playerMeta, setup);
    },
    [inviteFriend, playerMeta]
  );

  const handleCreateRoom = useCallback(
    (setup: HostGameSetup) => createRoom(playerMeta, setup),
    [createRoom, playerMeta]
  );

  const handleJoinRoom = useCallback(
    (code: string) => joinRoom(code, playerMeta),
    [joinRoom, playerMeta]
  );

  // Sair da espera pela sala: teardown no servidor — invalida a sala e avisa
  // o convidado. Era isto que faltava: o botão chamava `leaveQueue`, que só
  // mexe na fila de matchmaking e nunca desfazia a sala.
  const handleCancelRoom = useCallback(() => {
    if (roomCode) closeRoom(roomCode);
  }, [roomCode, closeRoom]);

  // Voltar da tela de sala desfaz as duas esperas possíveis: a sala (acima) e
  // a fila rápida, caso o usuário tenha entrado nela por outro caminho.
  const handleLeavePrivateRoom = useCallback(() => {
    handleCancelRoom();
    leaveQueue();
    setActiveScreen("home");
    setActiveTab("home");
  }, [handleCancelRoom, leaveQueue]);


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
        onSubscription: () => { handleUpgrade(); },
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
            moveErrorSeq={socketErrorSeq}
            isReconnecting={socketStatus === "reconnecting"}
            incomingDrawOffer={incomingDrawOffer}
            outgoingDrawOffer={outgoingDrawOffer}
            drawOfferDeclined={drawOfferDeclined}
            ratingOutcome={ratingOutcome}
            gamePublicId={gamePublicId}
            onUpgrade={handleUpgradeFromOnlineGame}
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
            onTraining={() => { setActiveScreen("puzzle_training"); }}
            onCorrespondence={handleOpenCorrespondence}
          />
        ) : activeScreen === "campaign_map" ? (
          <CampaignMapScreen
            onPlayLevel={handlePlayCampaignLevel}
            onBack={() => { setActiveScreen("home"); setActiveTab("home"); }}
          />
        ) : activeScreen === "ai_setup" ? (
          <AiGameSetupScreen
            initial={aiSetupInitial}
            lockedLevel={lockedLevel}
            onStart={handleStartConfiguredGame}
            onBack={() => {
              // Veio do mapa? volta para o mapa. Entrada direta volta à Home.
              if (lockedLevel) { setActiveScreen("campaign_map"); return; }
              setActiveScreen("home");
              setActiveTab("home");
            }}
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
              onUpgrade={handleUpgrade}
              onLeave={() => setActiveScreen("home")}
            />
          </View>
        ) : activeScreen === "puzzles" ? (
          <PuzzleScreen
            mode="daily"
            onBack={() => {
              setActiveScreen("home");
              setActiveTab("home");
            }}
            onUpgrade={handleUpgrade}
          />
        ) : activeScreen === "puzzle_training" ? (
          <PuzzleScreen
            mode="training"
            onBack={() => {
              setActiveScreen("home");
              setActiveTab("home");
            }}
            onUpgrade={handleUpgrade}
          />
        ) : activeScreen === "private_room" ? (
          <MatchmakingScreen
            status={socketStatus}
            roomCode={roomCode}
            onJoinQueue={joinQueue}
            onCancelRoom={handleCancelRoom}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            onInviteFriend={handleInviteFriend}
            initialTab="friend"
            onBack={handleLeavePrivateRoom}
          />
        ) : activeScreen === "profile" ? (
          // `onUpgrade` desce até o detalhe de partida (Perfil → Histórico →
          // Partida), onde o bloqueio por plano precisa de destino.
          <ProfileScreen onUpgrade={handleUpgrade} />
        ) : activeScreen === "settings" ? (
          <SettingsScreen onBack={() => setActiveScreen("home")} />
        ) : activeScreen === "leaderboard" ? (
          <LeaderboardScreen onBack={() => setActiveScreen("home")} />
        ) : activeScreen === "subscription" ? (
          <SubscriptionScreen onBack={() => setActiveScreen("home")} />
        ) : activeScreen === "correspondence_list" ? (
          <CorrespondenceListScreen
            onBack={() => { setActiveScreen("home"); setActiveTab("home"); }}
            onChallenge={() => setActiveScreen("correspondence_challenge")}
            onOpenGame={handleOpenCorrespondenceGame}
          />
        ) : activeScreen === "correspondence_challenge" ? (
          <CorrespondenceChallengeScreen
            onBack={() => setActiveScreen("correspondence_list")}
            onChallengeSent={() => setActiveScreen("correspondence_list")}
            onMatched={handleOpenCorrespondenceGame}
            onlineFriendIds={onlineFriendIds}
            watchPresence={watchPresence}
          />
        ) : activeScreen === "correspondence_game" && correspondenceGame ? (
          <CorrespondenceGameScreen
            game={correspondenceGame}
            onBack={() => {
              setCorrespondenceGame(null);
              setActiveScreen("correspondence_list");
            }}
            onUpgrade={handleUpgrade}
          />
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
              style={[styles.continueButton, { backgroundColor: colors.accent }]}
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
              <Text style={[styles.continueButtonText, { color: colors.accentText }]}>Continuar</Text>
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
