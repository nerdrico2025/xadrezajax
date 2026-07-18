import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { getPuzzleStats } from "@/services/puzzles";
import LeaderboardScreen from "./LeaderboardScreen";

const CHESS_QUOTES = [
  "O xadrez é a arte de análise. — Mikhail Botvinnik",
  "Xadrez é 99% tática. — Richard Teichmann",
  "Quando você vê um bom lance, procure um melhor. — Emanuel Lasker",
  "O tabuleiro não mente. — Garry Kasparov",
  "Cada peça colocada corretamente é metade da vitória.",
];

const DAILY_QUOTE = CHESS_QUOTES[new Date().getDate() % CHESS_QUOTES.length];

type Props = {
  onPlayAI: () => void;
  onPlayOnline: () => void;
  onPrivateRoom: () => void;
  onPlayPuzzles: () => void;
};

export default function HomeScreen({ onPlayAI, onPlayOnline, onPrivateRoom, onPlayPuzzles }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const { user, token } = useAuth();
  const { profile } = useProfile();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [puzzleStreak, setPuzzleStreak] = useState(0);

  // Streak de puzzles para o chip dourado do card (0.6-D) — falha silenciosa:
  // sem rede o card continua funcional, só sem o chip.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPuzzleStats(token)
      .then((stats) => {
        if (!cancelled) setPuzzleStreak(stats.streak);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (showLeaderboard) {
    return <LeaderboardScreen onBack={() => setShowLeaderboard(false)} />;
  }

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  };

  // Rating Glicko-2 da modalidade padrão (blitz); "~" sinaliza o período
  // provisório (primeiras 20 partidas). Fallback: espelho legado user.rating.
  const blitzRating = profile?.ratings?.blitz ?? {
    rating: user?.rating ?? 1500,
    provisional: true,
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Greeting ─────────────────────────────────────────────── */}
      <View style={styles.greetRow}>
        <View>
          <Text style={[styles.greetSub, { color: colors.secondary }]}>
            {greeting()},
          </Text>
          <Text style={[styles.greetName, { color: colors.text }]}>
            {user?.full_name?.split(" ")[0] ?? user?.username ?? "Jogador"} ♟
          </Text>
        </View>
        <View
          style={[
            styles.ratingBadge,
            { backgroundColor: colors.accentMuted, borderColor: colors.accent + "55" },
          ]}
          accessibilityLabel={
            blitzRating.provisional
              ? `Rating blitz ${blitzRating.rating}, ainda em calibração`
              : `Rating blitz ${blitzRating.rating}`
          }
        >
          <Ionicons name="trophy-outline" size={14} color={colors.accentOnLight} />
          {/* Rating em dourado (R2). No claro usa accentOnLight (AA); no escuro = accent. */}
          <Text style={[styles.ratingText, { color: colors.accentOnLight }]}>
            {blitzRating.provisional ? `~${blitzRating.rating}` : blitzRating.rating}
          </Text>
        </View>
      </View>

      {/* ── Quote of the day ─────────────────────────────────────── */}
      <View style={[styles.quoteCard, { backgroundColor: colors.card, borderColor: colors.divider }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.secondary} />
        <Text style={[styles.quoteText, { color: colors.secondary }]}>
          {DAILY_QUOTE}
        </Text>
      </View>

      {/* ── Section: Modos de Jogo ────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: colors.secondary }]}>
        Modos de jogo
      </Text>

      {/* Card: vs IA — CTA primária da Home (Dourado AJAX, texto preto — R1) */}
      <Pressable
        style={[styles.card, styles.cardElevated, { backgroundColor: colors.accent }]}
        onPress={onPlayAI}
        android_ripple={{ color: "rgba(13,13,13,0.12)" }}
      >
        <View style={styles.cardLeft}>
          <Text style={[styles.cardPieceWhite, { color: colors.accentText }]}>♖</Text>
          <View>
            <Text style={[styles.cardTitleWhite, { color: colors.accentText }]}>Jogar vs IA</Text>
            <Text style={[styles.cardSubWhite, { color: colors.accentText, opacity: 0.7 }]}>Escolha a dificuldade</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color="rgba(13,13,13,0.6)" />
      </Pressable>

      {/* Card: Online */}
      <Pressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider, borderWidth: 1 }]}
        onPress={onPlayOnline}
        android_ripple={{ color: colors.primary + "20" }}
      >
        <View style={styles.cardLeft}>
          <Text style={[styles.cardPiece, { color: colors.text }]}>♛</Text>
          <View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Partida Online</Text>
            <Text style={[styles.cardSub, { color: colors.secondary }]}>Busca rápida por oponente</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
      </Pressable>

      {/* Card: Sala Privada */}
      <Pressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider, borderWidth: 1 }]}
        onPress={onPrivateRoom}
        android_ripple={{ color: colors.primary + "20" }}
      >
        <View style={styles.cardLeft}>
          <Text style={[styles.cardPiece, { color: colors.text }]}>♞</Text>
          <View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Sala Privada</Text>
            <Text style={[styles.cardSub, { color: colors.secondary }]}>Jogue com um amigo</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
      </Pressable>

      {/* Card: Puzzle do dia */}
      <Pressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider, borderWidth: 1 }]}
        onPress={onPlayPuzzles}
        android_ripple={{ color: colors.primary + "20" }}
      >
        <View style={styles.cardLeft}>
          <Ionicons name="extension-puzzle" size={28} color={colors.accent} style={styles.cardIcon} />
          <View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Puzzle do dia</Text>
            <Text style={[styles.cardSub, { color: colors.secondary }]}>Treine táticas em poucos lances</Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          {puzzleStreak > 0 && (
            /* Chip de streak em dourado (0.6-D) — número em colors.text
               (dourado como texto reprova contraste AA no tema claro) */
            <View
              style={[
                styles.streakChip,
                { backgroundColor: colors.accentMuted, borderColor: colors.accent + "55" },
              ]}
              accessibilityLabel={`Sequência de ${puzzleStreak} dias de puzzle`}
            >
              {/* Streak em dourado (R2). No claro usa accentOnLight (AA); no escuro = accent. */}
              <Ionicons name="flame" size={13} color={colors.accentOnLight} />
              <Text style={[styles.streakText, { color: colors.accentOnLight }]}>{puzzleStreak}</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
        </View>
      </Pressable>

      {/* Card: Classificação */}
      <Pressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider, borderWidth: 1, marginTop: 4 }]}
        onPress={() => setShowLeaderboard(true)}
        android_ripple={{ color: colors.primary + "20" }}
      >
        <View style={styles.cardLeft}>
          <Text style={[styles.cardPiece, { color: colors.accent }]}>♕</Text>
          <View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Classificação</Text>
            <Text style={[styles.cardSub, { color: colors.secondary }]}>Top jogadores do servidor</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
      </Pressable>

      {/* ── Stats ─────────────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: colors.secondary }]}>
        Seu desempenho
      </Text>

      <View style={styles.statsRow}>
        {[
          { label: "Vitórias", value: profile?.wins ?? "—", color: "#4ADE80" },
          { label: "Derrotas", value: profile?.losses ?? "—", color: colors.error },
          { label: "Empates",  value: profile?.draws ?? "—",  color: colors.secondary },
        ].map(({ label, value, color }) => (
          <View
            key={label}
            style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.divider }]}
          >
            <Text style={[styles.statValue, { color }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: colors.secondary }]}>{label}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },

  greetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  greetSub: { fontSize: 13 },
  greetName: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5, marginTop: 2 },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  ratingText: { fontSize: 15, fontWeight: "800" },

  quoteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 28,
  },
  quoteText: { flex: 1, fontSize: 12, lineHeight: 18, fontStyle: "italic" },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 18,
    borderRadius: 16,
    marginBottom: 12,
  },
  cardElevated: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 14 },

  // Card primário (fundo colorido) — texto sempre branco
  cardPieceWhite: { fontSize: 32, color: "#fff", width: 40, textAlign: "center" },
  cardTitleWhite: { fontSize: 16, fontWeight: "700", color: "#fff" },
  cardSubWhite: { fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 2 },

  // Cards secundários — cor vinda do tema
  cardPiece: { fontSize: 32, width: 40, textAlign: "center" },
  cardIcon: { width: 40, textAlign: "center" },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  cardRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  streakText: { fontSize: 12, fontWeight: "800" },

  statsRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11, marginTop: 4 },
});
