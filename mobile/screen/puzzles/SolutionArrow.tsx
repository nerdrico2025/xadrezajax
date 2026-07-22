import Svg, { Line, Polygon, Rect } from "react-native-svg";

/**
 * Seta da solução desenhada SOBRE o tabuleiro.
 *
 * Por que existe: no esgotamento (e no acerto) a solução aparecia como texto
 * solto abaixo do tabuleiro — "A jogada certa era Rh5". Quem está aprendendo
 * precisa traduzir a notação de volta para casas antes de entender o lance, que
 * é exatamente a habilidade que ainda não tem. Mostrar no tabuleiro elimina a
 * tradução.
 *
 * Coordenadas: o tabuleiro do Problema do dia nunca é invertido (brancas
 * sempre embaixo), então o arquivo 'a' fica à esquerda e a fileira 8 no topo.
 */

type Props = {
  /** Casa de origem em notação algébrica ("h1"). */
  from: string;
  /** Casa de destino ("h5"). */
  to: string;
  /** Lado do tabuleiro em pixels (é quadrado). */
  size: number;
  /** Cor da seta e dos destaques. */
  color: string;
};

function centerOf(square: string, sq: number) {
  const file = square.charCodeAt(0) - 97; // 'a' → 0
  const rank = Number(square[1]); // 1..8
  return { x: (file + 0.5) * sq, y: (8 - rank + 0.5) * sq };
}

export default function SolutionArrow({ from, to, size, color }: Props) {
  if (!size) return null;

  const sq = size / 8;
  const a = centerOf(from, sq);
  const b = centerOf(to, sq);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  // A haste começa afastada do centro da origem (para não cobrir a peça) e
  // termina onde a ponta começa.
  const headLen = sq * 0.44;
  const headHalf = sq * 0.26;
  const startGap = sq * 0.3;

  const x1 = a.x + ux * startGap;
  const y1 = a.y + uy * startGap;
  const tipX = b.x;
  const tipY = b.y;
  const baseX = tipX - ux * headLen;
  const baseY = tipY - uy * headLen;

  // Perpendicular, para as duas asas da ponta.
  const px = -uy;
  const py = ux;

  const head = [
    `${tipX},${tipY}`,
    `${baseX + px * headHalf},${baseY + py * headHalf}`,
    `${baseX - px * headHalf},${baseY - py * headHalf}`,
  ].join(" ");

  const squareBox = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    return { x: file * sq, y: (8 - rank) * sq };
  };
  const fromBox = squareBox(from);
  const toBox = squareBox(to);
  const inset = sq * 0.06;

  return (
    <Svg
      width={size}
      height={size}
      // Decorativo: a leitura acessível fica no rótulo do contêiner, que diz o
      // lance por extenso ("A jogada certa era Rh5, de h1 para h5").
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[fromBox, toBox].map((box, i) => (
        <Rect
          key={i}
          x={box.x + inset}
          y={box.y + inset}
          width={sq - inset * 2}
          height={sq - inset * 2}
          rx={sq * 0.12}
          fill={color}
          fillOpacity={0.22}
          stroke={color}
          strokeOpacity={0.9}
          strokeWidth={Math.max(2, sq * 0.05)}
        />
      ))}

      <Line
        x1={x1}
        y1={y1}
        x2={baseX}
        y2={baseY}
        stroke={color}
        strokeWidth={sq * 0.17}
        strokeLinecap="round"
        opacity={0.95}
      />
      <Polygon points={head} fill={color} opacity={0.95} />
    </Svg>
  );
}
