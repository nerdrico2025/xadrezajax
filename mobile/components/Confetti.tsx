import { useEffect, useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * Confete de comemoração — uma rajada só, sem loop.
 *
 * POR QUE NÃO UMA LIB (decisão registrada no PR):
 *   - react-native-confetti-cannon: última publicação em maio/2022, API Animated
 *     legada rodando na thread JS. É justamente o perfil que engasga em Android
 *     mid-range, e não há validação em RN 0.81 / Nova Arquitetura.
 *   - react-native-fast-confetti: mantida, mas exige @shopify/react-native-skia
 *     (dependência nativa nova, build nova, APK maior) e, na 2.x, peer
 *     `react-native-worklets >=0.7.0` — o projeto está em 0.5.1, fixado pelo
 *     Expo SDK 54. Conflito duro.
 *
 * Então: reanimated (já é dependência, já está no build nativo). TODA a animação
 * roda na thread de UI a partir de UM shared value — a thread JS não participa
 * do frame, que é a garantia de "não travar" que a lib não daria.
 *
 * Limpeza: `cancelAnimation` no unmount. O componente vive dentro do modal de
 * fim de jogo, então fechar o modal desmonta e para tudo.
 */

/** Paleta da marca. Sem laranja (D4). */
const AJAX_CONFETTI_COLORS = [
  "#C9A84C", // Dourado AJAX
  "#1B5F7A", // Azul Petróleo
  "#FFFFFF", // Branco
  "#F0EDE6", // Branco Marfim
  // Preto Tabuleiro (#0D0D0D) fica de fora de propósito: o confete cai sobre o
  // backdrop escuro do modal, onde preto é invisível.
];

const PARTICLE_COUNT = 36;
const FALL_MS = 2600;

type Particle = {
  color: string;
  /** Posição horizontal inicial, em fração da largura da tela. */
  startX: number;
  /** Deriva horizontal ao longo da queda, em px. */
  driftX: number;
  width: number;
  height: number;
  spins: number;
  /** Fração de FALL_MS antes de a partícula começar a cair. */
  delay: number;
  /** Fração de FALL_MS que a queda desta partícula leva. */
  duration: number;
};

function buildParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const color = AJAX_CONFETTI_COLORS[i % AJAX_CONFETTI_COLORS.length];
    return {
      color,
      startX: Math.random(),
      driftX: (Math.random() - 0.5) * 120,
      width: 6 + Math.random() * 5,
      height: 9 + Math.random() * 7,
      spins: 1 + Math.random() * 3,
      delay: Math.random() * 0.35,
      duration: 0.65 + Math.random() * 0.35,
    };
  });
}

type Props = {
  /** Quantidade de partículas. Menos em telas pequenas, se preciso. */
  count?: number;
};

export default function Confetti({ count = PARTICLE_COUNT }: Props) {
  const { width, height } = useWindowDimensions();
  // Sorteado uma vez: re-sortear a cada render mudaria as partículas no meio da
  // queda.
  const particles = useMemo(() => buildParticles(count), [count]);

  // Um único relógio 0 → 1 para todas as partículas. Cada uma lê a sua janela
  // (delay/duration) dentro dele.
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: FALL_MS,
      easing: Easing.linear,
    });
    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      // Decorativo: não anuncia nada ao leitor de tela (a vitória já é dita
      // pelo título do modal).
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {particles.map((p, i) => (
        <ConfettiPiece
          key={i}
          particle={p}
          progress={progress}
          screenWidth={width}
          screenHeight={height}
        />
      ))}
    </View>
  );
}

function ConfettiPiece({
  particle,
  progress,
  screenWidth,
  screenHeight,
}: {
  particle: Particle;
  progress: ReturnType<typeof useSharedValue<number>>;
  screenWidth: number;
  screenHeight: number;
}) {
  const { color, startX, driftX, width, height, spins, delay, duration } = particle;
  const left = startX * (screenWidth - width);
  const fallTo = screenHeight + height;

  const rStyle = useAnimatedStyle(() => {
    // Janela local da partícula dentro do relógio global.
    const t = Math.min(1, Math.max(0, (progress.value - delay) / duration));
    return {
      opacity: t <= 0 ? 0 : t > 0.9 ? (1 - t) / 0.1 : 1,
      transform: [
        { translateY: -height + t * fallTo },
        { translateX: Math.sin(t * Math.PI * 2) * driftX },
        { rotate: `${t * spins * 360}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        { left, width, height, backgroundColor: color },
        rStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  piece: {
    position: "absolute",
    top: 0,
    borderRadius: 1.5,
  },
});
