/**
 * Temas de tabuleiro configuráveis (PR E · item 5).
 *
 * Cada tema define apenas a APRESENTAÇÃO do tabuleiro — nunca a lógica de jogo.
 * O tema do tabuleiro é INDEPENDENTE do tema claro/escuro do app: o usuário pode
 * ter o app em dark mode e o tabuleiro claro.
 *
 * Assinatura da marca: em TODOS os temas, o destaque de casa selecionada e de
 * último lance usam o Dourado AJAX (#C9A84C) com transparência. Essa é a
 * assinatura visual da marca no tabuleiro.
 *
 * Cor das coordenadas: NÃO é um token fixo por tema. A lib react-native-chessboard
 * deriva a cor de cada coordenada da casa OPOSTA (clara sobre casa escura e
 * vice-versa), o que garante contraste WCAG nos dois tipos de casa em qualquer
 * tema. Fixar uma única cor de coordenada reprovaria o contraste em uma das casas.
 * Ou seja: a cor da coordenada também vem do tema ativo (dos tokens de casa).
 */

/** Dourado AJAX — cor de marca (RF-VISUAL-01). */
export const AJAX_GOLD = "#C9A84C";

// Dourado com transparência — assinatura da marca no tabuleiro, igual em todos
// os temas. Último lance preenche a casa; casa selecionada é um brilho sob a peça.
const GOLD_LAST_MOVE = "rgba(201, 168, 76, 0.5)";
const GOLD_SELECTED = "rgba(201, 168, 76, 0.45)";
// Xeque: vermelho de alerta, consistente entre temas. Não é laranja (proibido).
const CHECK_HIGHLIGHT = "#E5484D";

export type BoardThemeId = "marmore" | "madeira" | "petroleo" | "verde" | "preto";

export interface BoardTheme {
  id: BoardThemeId;
  name: string;
  /** Casa clara */
  lightSquare: string;
  /** Casa escura */
  darkSquare: string;
  /** Destaque de casa selecionada (dourado, todos os temas) */
  selectedHighlight: string;
  /** Destaque de último lance (dourado, todos os temas) */
  lastMoveHighlight: string;
  /** Destaque de xeque */
  checkHighlight: string;
}

export const BOARD_THEMES: Record<BoardThemeId, BoardTheme> = {
  // Mármore Clássico
  marmore: {
    id: "marmore",
    name: "Mármore Clássico",
    lightSquare: "#F0EDE6", // Branco Marfim
    darkSquare: "#B8B0A3",
    selectedHighlight: GOLD_SELECTED,
    lastMoveHighlight: GOLD_LAST_MOVE,
    checkHighlight: CHECK_HIGHLIGHT,
  },
  // Madeira AJAX — paleta oficial. Padrão para NOVOS usuários.
  madeira: {
    id: "madeira",
    name: "Madeira AJAX",
    lightSquare: "#E8D9BC",
    darkSquare: "#5C4A23", // Madeira
    selectedHighlight: GOLD_SELECTED,
    lastMoveHighlight: GOLD_LAST_MOVE,
    checkHighlight: CHECK_HIGHLIGHT,
  },
  // Azul Petróleo — paleta oficial v2.0
  petroleo: {
    id: "petroleo",
    name: "Azul Petróleo",
    lightSquare: "#E6ECF0",
    darkSquare: "#1B5F7A",
    selectedHighlight: GOLD_SELECTED,
    lastMoveHighlight: GOLD_LAST_MOVE,
    checkHighlight: CHECK_HIGHLIGHT,
  },
  // Verde Clássico — tema ATUAL (defaults da lib react-native-chessboard),
  // mantido para quem já se acostumou. Padrão para usuários EXISTENTES.
  verde: {
    id: "verde",
    name: "Verde Clássico",
    lightSquare: "#D9FDF8",
    darkSquare: "#62B1A8",
    selectedHighlight: GOLD_SELECTED,
    lastMoveHighlight: GOLD_LAST_MOVE,
    checkHighlight: CHECK_HIGHLIGHT,
  },
  // Preto & Marfim — alto contraste, alinhado ao "Preto Tabuleiro" da marca.
  // A casa escura da marca é #0D0D0D, mas a peça preta (outline ~#1A1A1A sobre
  // corpo carvão) perde definição de borda em #0D0D0D. Elevamos para #262626
  // para preservar a legibilidade da peça preta sem descaracterizar o tema.
  // Ver corpo do PR: "Contraste peça/casa".
  preto: {
    id: "preto",
    name: "Preto & Marfim",
    lightSquare: "#F0EDE6", // Branco Marfim
    darkSquare: "#262626",
    selectedHighlight: GOLD_SELECTED,
    lastMoveHighlight: GOLD_LAST_MOVE,
    checkHighlight: CHECK_HIGHLIGHT,
  },
};

/** Ordem de exibição no seletor. */
export const BOARD_THEME_ORDER: BoardThemeId[] = [
  "madeira",
  "marmore",
  "petroleo",
  "verde",
  "preto",
];

/** Padrão para usuários EXISTENTES (não trocar o tabuleiro de ninguém). */
export const DEFAULT_BOARD_THEME_ID: BoardThemeId = "verde";
/** Padrão para NOVOS usuários. */
export const NEW_USER_BOARD_THEME_ID: BoardThemeId = "madeira";

export function isBoardThemeId(value: unknown): value is BoardThemeId {
  return typeof value === "string" && value in BOARD_THEMES;
}

/**
 * Converte um BoardTheme no objeto `colors` esperado pelo prop do
 * react-native-chessboard. `white` = casa clara, `black` = casa escura
 * (convenção interna da lib). `selectedSquareHighlight` é um campo adicionado
 * via patch-package (ver patches/react-native-chessboard+0.1.2.patch).
 */
export function toChessboardColors(theme: BoardTheme) {
  return {
    white: theme.lightSquare,
    black: theme.darkSquare,
    lastMoveHighlight: theme.lastMoveHighlight,
    checkmateHighlight: theme.checkHighlight,
    selectedSquareHighlight: theme.selectedHighlight,
  };
}
