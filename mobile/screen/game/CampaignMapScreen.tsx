import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import type { Difficulty } from "@/constants/aiGame";
import {
  useCampaignUnlockState,
  winsMissingFor,
  type CampaignNode,
} from "@/hooks/useCampaignUnlockState";

// Mapa da Campanha — a trilha dos 5 níveis da IA.
//
// O TRILHO É SERPENTEADO e feito de `View` posicionada, não de SVG: são 5 nós
// numa coluna, alternando esquerda/direita, e o "caminho" entre eles é um
// segmento diagonal por par. Com essa contagem, SVG custaria uma dependência
// e um viewBox a manter sem entregar nada que o layout não resolva.
//
// O estado de cada nó NÃO é decidido aqui: vem de `useCampaignUnlockState`,
// que é a mesma fonte que o wizard usa para desenhar o cadeado. Duas telas
// com a mesma regra escrita duas vezes é a receita para elas divergirem.

/** Deslocamento horizontal do nó em relação ao centro, por posição na trilha.
 *  É o que dá o serpenteado — nó par à esquerda, ímpar à direita. */
const SERPENTINE_OFFSET = 52;

const NODE_SIZE = 68;
const NODE_SIZE_CURRENT = 84;
/** Altura do espaço entre dois nós — é onde o segmento do trilho é desenhado. */
const GAP = 46;

interface Props {
  /** Abre o wizard já travado neste nível, pulando a escolha de dificuldade. */
  onPlayLevel: (level: Difficulty) => void;
  onBack: () => void;
}

export default function CampaignMapScreen({ onPlayLevel, onBack }: Props) {
  const { theme } = useTheme();
  const colors = Colors[theme];
  const insets = useSafeAreaInsets();
  const { nodes, loading, error, refresh, blocking } = useCampaignUnlockState();

  // Feedback do toque em nó bloqueado. Inline (e não Alert) porque o mapa é
  // uma tela de leitura: um diálogo modal para dizer "ainda não" interrompe
  // mais do que informa.
  const [aviso, setAviso] = useState<string | null>(null);

  const handlePress = useCallback(
    (node: CampaignNode, index: number) => {
      if (blocking) return;

      if (node.state === "locked") {
        const faltando = winsMissingFor(nodes, index);
        setAviso(
          faltando
            ? `Vença mais ${faltando.faltam} ${
                faltando.faltam === 1 ? "partida" : "partidas"
              } no nível ${faltando.anterior} para destravar ${node.label}.`
            : `Vença partidas no nível anterior para destravar ${node.label}.`
        );
        return;
      }

      // Concluído é JOGÁVEL (prática livre), não inerte. Decisão de baixo
      // risco tomada aqui: um nó dominado que não responde ao toque parece
      // quebrado, e revisitar um nível fácil é um uso legítimo — o progresso
      // não muda, porque o selo já foi concedido e não é concedido de novo.
      setAviso(null);
      onPlayLevel(node.id);
    },
    [blocking, nodes, onPlayLevel]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, borderBottomColor: colors.divider },
        ]}
      >
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Modo Campanha
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading && !nodes.length ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : null}

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.errorText, { color: colors.secondary }]}>
            Não foi possível carregar o seu progresso.
          </Text>
          <Pressable onPress={refresh} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>
              Tentar novamente
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[
          styles.trail,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {nodes.map((node, index) => (
          <TrailStep
            key={node.id}
            node={node}
            index={index}
            isLast={index === nodes.length - 1}
            colors={colors}
            onPress={() => handlePress(node, index)}
          />
        ))}
      </ScrollView>

      {aviso ? (
        <View
          style={[
            styles.aviso,
            {
              backgroundColor: colors.card,
              borderColor: colors.divider,
              marginBottom: insets.bottom + 12,
            },
          ]}
          accessibilityRole="alert"
        >
          <Ionicons name="lock-closed" size={16} color={colors.secondary} />
          <Text style={[styles.avisoText, { color: colors.text }]}>{aviso}</Text>
        </View>
      ) : null}
    </View>
  );
}

type ThemeColors = (typeof Colors)[keyof typeof Colors];

function TrailStep({
  node,
  index,
  isLast,
  colors,
  onPress,
}: {
  node: CampaignNode;
  index: number;
  isLast: boolean;
  colors: ThemeColors;
  onPress: () => void;
}) {
  const daDireita = index % 2 === 1;
  const offset = daDireita ? SERPENTINE_OFFSET : -SERPENTINE_OFFSET;
  const isCurrent = node.state === "current";
  const isDone = node.state === "done";
  const size = isCurrent ? NODE_SIZE_CURRENT : NODE_SIZE;

  // Concluído: dourado SÓLIDO. Atual: azul petróleo — segunda cor de destaque,
  // porque o dourado já é a cor de "conquistado" na mesma tela e um nó atual
  // dourado competiria com os concluídos em vez de se destacar deles.
  const fundo = isDone
    ? colors.accent
    : isCurrent
    ? colors.primary
    : colors.buttonSecondary;
  const conteudo = isDone
    ? colors.accentText
    : isCurrent
    ? colors.primaryText
    : colors.secondary;

  const rotulo =
    node.state === "locked"
      ? `${node.label}, bloqueado`
      : isDone
      ? `${node.label}, concluído`
      : `${node.label}, nível atual, ${node.wins} de ${node.winsToUnlock} vitórias`;

  return (
    <View style={styles.step}>
      <Pressable
        onPress={onPress}
        style={[
          styles.node,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: fundo,
            transform: [{ translateX: offset }],
            opacity: node.state === "locked" ? 0.45 : 1,
            borderColor: isCurrent ? colors.primary : "transparent",
            borderWidth: isCurrent ? 3 : 0,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={rotulo}
        accessibilityState={{ disabled: node.state === "locked" }}
      >
        <Ionicons
          name={
            isDone
              ? "checkmark"
              : node.state === "locked"
              ? "lock-closed"
              : (node.icon as any)
          }
          size={isCurrent ? 30 : 26}
          color={conteudo}
        />
      </Pressable>

      {/* Rótulo do nó, ao lado (segue o serpenteado, no lado oposto ao nó
          para não brigar por espaço em tela estreita). */}
      <View
        style={[
          styles.labelBox,
          daDireita ? styles.labelLeft : styles.labelRight,
        ]}
      >
        <Text
          style={[
            styles.label,
            { color: node.state === "locked" ? colors.secondary : colors.text },
          ]}
          numberOfLines={1}
        >
          {node.label}
        </Text>
        {isCurrent ? (
          <>
            <Text style={[styles.progresso, { color: colors.primary }]}>
              {node.wins}/{node.winsToUnlock} vitórias
            </Text>
            {/* "Você está aqui" — a peça marca a posição do jogador na trilha. */}
            <View style={styles.aqui}>
              <Text style={[styles.peca, { color: colors.accentOnLight }]}>♟</Text>
              <Text style={[styles.aquiText, { color: colors.accentOnLight }]}>
                você está aqui
              </Text>
            </View>
          </>
        ) : (
          <Text style={[styles.elo, { color: colors.secondary }]}>
            ~{node.elo}
          </Text>
        )}
        {node.unlockedByQaOnly ? (
          <Text style={[styles.qa, { color: colors.secondary }]}>
            destravado só no build de QA
          </Text>
        ) : null}
      </View>

      {/* Segmento do trilho até o próximo nó. Dourado quando o nível já foi
          concluído (o caminho "andado"), neutro à frente. */}
      {!isLast ? (
        <View
          style={[
            styles.conector,
            {
              backgroundColor: isDone ? colors.accent : colors.divider,
              transform: [
                { translateX: offset },
                { rotate: daDireita ? "-28deg" : "28deg" },
              ],
            },
          ]}
        />
      ) : null}
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
  center: { paddingVertical: 24, alignItems: "center" },
  errorBox: {
    margin: 16,
    padding: 12,
    borderRadius: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  errorText: { fontSize: 13, flexShrink: 1 },
  retry: { fontSize: 13, fontWeight: "700" },
  trail: { paddingTop: 28, alignItems: "center" },
  step: { alignItems: "center", width: "100%" },
  node: { alignItems: "center", justifyContent: "center" },
  labelBox: { position: "absolute", top: 8, maxWidth: 140 },
  // O rótulo vai do lado OPOSTO ao deslocamento do nó: nó à direita, texto à
  // esquerda. Em 320px é o que impede o texto de sair da tela.
  labelLeft: { right: "58%", alignItems: "flex-end" },
  labelRight: { left: "58%", alignItems: "flex-start" },
  label: { fontSize: 15, fontWeight: "700" },
  elo: { fontSize: 11 },
  progresso: { fontSize: 12, fontWeight: "700" },
  aqui: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  peca: { fontSize: 14 },
  aquiText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  qa: { fontSize: 9, fontStyle: "italic", marginTop: 2 },
  conector: { width: 4, height: GAP, borderRadius: 2, marginVertical: 4 },
  aviso: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  avisoText: { fontSize: 13, flexShrink: 1 },
});
