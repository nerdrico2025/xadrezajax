// Configuração de partida vs IA (PR C, item 7).
// Fonte única de verdade compartilhada pelo wizard, pelo GameScreen e pela
// persistência da última configuração.

export type Difficulty = "beginner" | "easy" | "medium" | "hard" | "master";
export type PlayerColor = "w" | "b";
/** Escolha de cor no wizard — "random" é resolvido para w/b ao iniciar. */
export type ColorChoice = PlayerColor | "random";

export interface AiLevel {
  id: Difficulty;
  label: string;
  /** Elo aproximado exibido na UI ("Fácil · ~1100"). */
  elo: number;
  description: string;
  icon: string;
  color: string;
}

// Os 5 níveis. A calibragem real (Skill Level + depth + movetime) vive no
// node-api (stockfish.service.js); aqui só o rótulo/Elo aproximado.
export const AI_LEVELS: AiLevel[] = [
  { id: "beginner", label: "Iniciante", elo: 800, description: "Primeiros passos no xadrez", icon: "egg-outline", color: "#4CAF50" },
  { id: "easy", label: "Fácil", elo: 1100, description: "Para quem está pegando o jeito", icon: "leaf-outline", color: "#8BC34A" },
  // Escalada verde→amarelo→vermelho SEM laranja (D4: laranja proibido). Os antigos
  // #FFB300/#FB8C00 eram laranja; substituídos por amarelo (#EAB308) e vermelhos.
  { id: "medium", label: "Médio", elo: 1400, description: "Um bom desafio", icon: "flame-outline", color: "#EAB308" },
  { id: "hard", label: "Difícil", elo: 1700, description: "Exige atenção e cálculo", icon: "flash-outline", color: "#E53935" },
  { id: "master", label: "Mestre", elo: 2000, description: "A IA no máximo da força", icon: "skull-outline", color: "#B71C1C" },
];

export const AI_LEVEL_BY_ID: Record<Difficulty, AiLevel> = AI_LEVELS.reduce(
  (acc, l) => ({ ...acc, [l.id]: l }),
  {} as Record<Difficulty, AiLevel>
);

// ── Controles de tempo ──────────────────────────────────────────────────────
// Linguagem simples no lugar do jargão (Bullet/Blitz/Rápido/Clássico), que não
// dizia nada para quem está começando. Cada categoria é uma escolha de toque
// direto, exceto "Pensado", que expande as três durações na própria tela.
//
// Isto vale SÓ para o modo vs IA. O modo online tem seu próprio tempo fixo
// (ONLINE_TIME_CONTROL em app/home.tsx) e não usa nada deste arquivo.
//
// base em segundos (null = sem limite), increment em segundos (Fischer).
export type AiTimeCategory = "flash" | "quick" | "thoughtful" | "untimed";

export interface AiTimeControl {
  id: string;
  label: string; // "10 min"
  category: AiTimeCategory;
  base: number | null; // segundos; null = sem limite
  increment: number;
}

// Incremento 0 em todos: a UI nova não expõe incremento Fischer, e o relógio
// (useChessClock) trata 0 como "sem incremento" sem caso especial.
export const AI_TIME_CONTROLS: AiTimeControl[] = [
  { id: "flash_1", label: "1 min", category: "flash", base: 60, increment: 0 },
  { id: "quick_3", label: "3 min", category: "quick", base: 180, increment: 0 },
  { id: "thoughtful_5", label: "5 min", category: "thoughtful", base: 300, increment: 0 },
  { id: "thoughtful_10", label: "10 min", category: "thoughtful", base: 600, increment: 0 },
  { id: "thoughtful_15", label: "15 min", category: "thoughtful", base: 900, increment: 0 },
  { id: "untimed", label: "Sem tempo", category: "untimed", base: null, increment: 0 },
];

export const AI_TIME_BY_ID: Record<string, AiTimeControl> = AI_TIME_CONTROLS.reduce(
  (acc, t) => ({ ...acc, [t.id]: t }),
  {} as Record<string, AiTimeControl>
);

export interface AiTimeCategoryOption {
  id: AiTimeCategory;
  label: string;
  sub: string;
  icon: string;
  /** True quando a categoria abre durações na própria tela ("Pensado"). */
  expandable: boolean;
}

export const AI_TIME_CATEGORIES: AiTimeCategoryOption[] = [
  { id: "flash", label: "Relâmpago", sub: "1 minuto", icon: "flash-outline", expandable: false },
  { id: "quick", label: "Rápido", sub: "3 minutos", icon: "timer-outline", expandable: false },
  { id: "thoughtful", label: "Pensado", sub: "5, 10 ou 15 minutos", icon: "hourglass-outline", expandable: true },
  { id: "untimed", label: "Sem tempo", sub: "Partida sem relógio", icon: "infinite-outline", expandable: false },
];

/** Duração pré-selecionada ao escolher "Pensado" — o resumo e o início
 *  precisam de um valor válido desde o primeiro toque. */
export const THOUGHTFUL_DEFAULT_ID = "thoughtful_10";

/** Tempo padrão do wizard quando não há configuração salva. */
export const DEFAULT_TIME_ID = "quick_3";

/** Durações de "Pensado", na ordem em que aparecem expandidas. */
export const THOUGHTFUL_OPTIONS: AiTimeControl[] = AI_TIME_CONTROLS.filter(
  (t) => t.category === "thoughtful"
);

/** Resumo curto para o rodapé do wizard. */
export function timeControlSummary(tc: AiTimeControl): string {
  return tc.label;
}
