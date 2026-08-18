import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
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

// Mapa da Campanha — a trilha ilustrada dos 5 níveis.
//
// O FUNDO É ARTE, não desenho em código: `assets/campaign/mapa-campanha-ajax.webp`
// (1080×3840, SEM texto embutido — a versão anterior tinha os nomes dos
// territórios queimados na imagem e foi trocada por esta, exportada de propósito
// sem tipografia, para o contraste do texto poder ser ajustado por tema/fundo).
//
// Os nomes de região e os 5 nós são componentes React sobrepostos à arte, nas
// coordenadas de `mobile/assets/campaign/labels-manifest.json` (pixels da
// imagem original 1080×3840, convertidos em % da mesma caixa que os nós já
// usavam — por isso ambos compartilham o mesmo sistema sem conversão extra).

const ART = require("@/assets/campaign/mapa-campanha-ajax.webp");

/** Dimensões da arte, em pixels. As coordenadas dos nós são dadas neste
 *  espaço e convertidas em porcentagem — assim o posicionamento acompanha
 *  qualquer largura de tela sem depender de medição. */
const ART_WIDTH = 1080;
const ART_HEIGHT = 3840;

/**
 * Onde cada nó cai sobre a trilha, em pixels da arte.
 *
 * A ordem aqui é a da CAMPANHA (Iniciante → Mestre), mas repare que o `y`
 * DIMINUI: a trilha sobe, do Vale das Bandeiras (embaixo) até a Cidadela do
 * Adversário (no topo). Mexer nestes números sem olhar a arte tira o nó de
 * cima do caminho.
 */
const NODE_POSITIONS: Record<Difficulty, { x: number; y: number }> = {
  beginner: { x: 540, y: 3480 },
  easy: { x: 770, y: 2790 },
  medium: { x: 360, y: 2100 },
  hard: { x: 730, y: 1400 },
  master: { x: 540, y: 540 },
};

const NODE_SIZE = 58;
const NODE_SIZE_CURRENT = 72;

/**
 * Nomes das regiões, na mesma caixa de coordenadas dos nós (pixels da arte
 * 1080×3840). Vem de `labels-manifest.json` — `tamanho` é o tamanho na arte
 * original, usado só como referência de proporção entre labels, não como
 * fontSize final (que escala com a largura real da tela, ver `RegionLabel`).
 */
const REGION_LABELS: Record<Difficulty, { text: string; x: number; y: number; tamanho: number }> = {
  master: { text: "CIDADELA DO ADVERSÁRIO", x: 540, y: 862, tamanho: 38 },
  hard: { text: "DESFILADEIRO DA TORRE", x: 742, y: 1218, tamanho: 32 },
  medium: { text: "PASSO DAS SENTINELAS", x: 372, y: 1910, tamanho: 32 },
  easy: { text: "BOSQUE RASTEIRO", x: 782, y: 2600, tamanho: 32 },
  beginner: { text: "VALE DAS BANDEIRAS", x: 540, y: 3320, tamanho: 34 },
};

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
  const { width: windowWidth } = useWindowDimensions();

  // Feedback do toque em nó bloqueado. Inline (e não Alert) porque o mapa é
  // uma tela de leitura: um diálogo modal para dizer "ainda não" interrompe
  // mais do que informa.
  const [aviso, setAviso] = useState<string | null>(null);

  // Escala da arte para a largura real da tela: a caixa da arte (`artBox`)
  // tem `width: "100%"` sem padding ao redor, então a largura da janela é a
  // largura renderizada da imagem. Usada tanto para converter as coordenadas
  // do manifest em pixels de tela quanto para o scroll inicial (Fix 1B).
  const artScale = windowWidth / ART_WIDTH;
  const artHeightPx = ART_HEIGHT * artScale;

  // Scroll inicial no nó do nível atual (Fix 1B). `nodes` sempre tem 5
  // entradas (vem de AI_LEVELS), então não dá pra usar `nodes.length` como
  // sinal de "progresso ainda não carregou" — por isso esperamos `loading`
  // virar false (sucesso OU erro já assentado) antes do scroll único.
  const scrollRef = useRef<ScrollView>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const hasScrolledRef = useRef(false);

  const handleScrollViewLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportHeight(e.nativeEvent.layout.height);
  }, []);

  useEffect(() => {
    if (hasScrolledRef.current || loading || !viewportHeight) return;

    const currentNode = nodes.find((n) => n.state === "current");
    const target = NODE_POSITIONS[currentNode?.id ?? "beginner"];
    const targetY = (target.y / ART_HEIGHT) * artHeightPx;

    // Centraliza o nó na viewport, não só encosta no topo — e nunca deixa
    // scrollar para além do conteúdo (arte + padding de baixo).
    const contentHeight = artHeightPx + insets.bottom;
    const maxOffset = Math.max(0, contentHeight - viewportHeight);
    const offset = Math.min(maxOffset, Math.max(0, targetY - viewportHeight / 2));

    scrollRef.current?.scrollTo({ y: offset, animated: false });
    hasScrolledRef.current = true;
  }, [loading, viewportHeight, nodes, artHeightPx, insets.bottom]);

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

      // Concluído é JOGÁVEL (prática livre), não inerte: um nó dominado que
      // não responde ao toque parece quebrado, e o progresso não muda —
      // o selo já foi concedido e não é concedido de novo.
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
        ref={scrollRef}
        onLayout={handleScrollViewLayout}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* `aspectRatio` em vez de medir a tela: a arte mantém a proporção
            1080:3840 em qualquer largura, e os nós são posicionados em % da
            MESMA caixa — então não há um segundo cálculo para dessincronizar. */}
        <View style={styles.artBox}>
          <Image
            source={ART}
            style={styles.art}
            resizeMode="cover"
            accessible
            accessibilityLabel="Mapa ilustrado da campanha, do Vale das Bandeiras até a Cidadela do Adversário"
          />

          {(Object.keys(REGION_LABELS) as Difficulty[]).map((id) => (
            <RegionLabel key={id} label={REGION_LABELS[id]} scale={artScale} />
          ))}

          {nodes.map((node, index) => (
            <MapNode
              key={node.id}
              node={node}
              index={index}
              colors={colors}
              onPress={() => handlePress(node, index)}
            />
          ))}
        </View>
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

function MapNode({
  node,
  index,
  colors,
  onPress,
}: {
  node: CampaignNode;
  index: number;
  colors: ThemeColors;
  onPress: () => void;
}) {
  const pos = NODE_POSITIONS[node.id];
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
    : "rgba(20,24,28,0.55)";
  const conteudo = isDone
    ? colors.accentText
    : isCurrent
    ? colors.primaryText
    : "rgba(255,255,255,0.75)";

  const rotulo =
    node.state === "locked"
      ? `${node.label}, bloqueado`
      : isDone
      ? `${node.label}, concluído`
      : `${node.label}, nível atual, ${node.wins} de ${node.winsToUnlock} vitórias`;

  return (
    <View
      style={[
        styles.nodeAnchor,
        {
          left: `${(pos.x / ART_WIDTH) * 100}%`,
          top: `${(pos.y / ART_HEIGHT) * 100}%`,
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onPress}
        style={[
          styles.node,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: fundo,
            // Centraliza o nó no ponto: o anchor marca a coordenada exata, e
            // metade do tamanho tira o canto superior esquerdo de cima dela.
            marginLeft: -size / 2,
            marginTop: -size / 2,
            // Aro branco para o nó se destacar de qualquer trecho da arte —
            // a trilha é clara, a floresta é escura.
            borderWidth: isCurrent ? 3 : 2,
            borderColor: isCurrent ? colors.primaryText : "rgba(255,255,255,0.85)",
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
          size={isCurrent ? 28 : 24}
          color={conteudo}
        />
      </Pressable>

      {/* Só o nó ATUAL ganha texto por cima da arte, e só o que a arte não
          tem: o contador de vitórias e o "você está aqui". Os NOMES dos
          territórios já estão ilustrados — repeti-los aqui brigaria com a
          tipografia do mapa. */}
      {isCurrent ? (
        <View
          style={[
            styles.badge,
            { backgroundColor: colors.primary, marginTop: size / 2 - 4 },
          ]}
        >
          <Text style={[styles.badgeWins, { color: colors.primaryText }]}>
            {node.wins}/{node.winsToUnlock} vitórias
          </Text>
          <View style={styles.aqui}>
            <Text style={[styles.peca, { color: colors.primaryText }]}>♟</Text>
            <Text style={[styles.aquiText, { color: colors.primaryText }]}>
              você está aqui
            </Text>
          </View>
        </View>
      ) : null}

      {node.unlockedByQaOnly ? (
        <View style={[styles.qaBadge, { marginTop: size / 2 - 4 }]}>
          <Text style={styles.qaText}>destravado só no build de QA</Text>
        </View>
      ) : null}
    </View>
  );
}

function RegionLabel({
  label,
  scale,
}: {
  label: { text: string; x: number; y: number; tamanho: number };
  scale: number;
}) {
  // fontSize escala com a largura real da tela (a arte é 1080px de origem,
  // renderizada em ~360-430px num telefone) e ganha um reforço de +15% sobre
  // o tamanho da arte antiga — critério de aceite é "visivelmente maior".
  const fontSize = Math.round(label.tamanho * scale * 1.15);

  return (
    <View
      style={[
        styles.nodeAnchor,
        {
          left: `${(label.x / ART_WIDTH) * 100}%`,
          top: `${(label.y / ART_HEIGHT) * 100}%`,
          marginTop: -fontSize,
        },
      ]}
      pointerEvents="none"
    >
      <View style={styles.labelScrim}>
        <Text
          style={[
            styles.labelText,
            {
              fontSize,
              // Cinzel (fonte da arte original) não está empacotada no app;
              // '700' é o mesmo peso de heading já usado no resto da tela.
              fontWeight: "700",
              letterSpacing: 1.5,
            },
          ]}
        >
          {label.text}
        </Text>
      </View>
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
  artBox: { width: "100%", aspectRatio: ART_WIDTH / ART_HEIGHT },
  art: { width: "100%", height: "100%" },
  // Caixa de tamanho zero na coordenada exata: os filhos se posicionam em
  // relação a ela, então o nó e o balão nunca saem de sincronia.
  nodeAnchor: { position: "absolute", width: 0, height: 0, alignItems: "center" },
  node: { alignItems: "center", justifyContent: "center" },
  // Scrim sólido (regra de marca: sem gradiente) atrás do nome da região —
  // aproximação de --bg-deep (#0F1E24) do brand guide, semi-transparente
  // para funcionar tanto sobre trecho claro quanto escuro da arte.
  labelScrim: {
    backgroundColor: "rgba(15,30,36,0.55)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  labelText: {
    color: "#F4F1EA",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    alignItems: "center",
    // Largo o bastante para "VOCÊ ESTÁ AQUI" caber em UMA linha — quebrado
    // em duas, o balão vira um bloco alto que cobre a trilha.
    minWidth: 136,
  },
  badgeWins: { fontSize: 12, fontWeight: "800" },
  aqui: { flexDirection: "row", alignItems: "center", gap: 4 },
  peca: { fontSize: 12 },
  aquiText: { fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  aquiLinha: { flexShrink: 0 },
  qaBadge: {
    backgroundColor: "rgba(20,24,28,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  qaText: { fontSize: 9, fontStyle: "italic", color: "rgba(255,255,255,0.85)" },
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
