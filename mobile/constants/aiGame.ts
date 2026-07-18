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

// ── Controles de tempo (item 7) ─────────────────────────────────────────────
// base em segundos (null = sem limite), increment em segundos (Fischer).
export type TimeGroup = "Bullet" | "Blitz" | "Rápido" | "Clássico" | "Livre";

export interface AiTimeControl {
  id: string;
  label: string; // "3+2"
  group: TimeGroup;
  base: number | null; // segundos; null = sem limite
  increment: number;
}

export const AI_TIME_CONTROLS: AiTimeControl[] = [
  { id: "bullet_1_0", label: "1+0", group: "Bullet", base: 60, increment: 0 },
  { id: "bullet_2_1", label: "2+1", group: "Bullet", base: 120, increment: 1 },
  { id: "blitz_3_0", label: "3+0", group: "Blitz", base: 180, increment: 0 },
  { id: "blitz_3_2", label: "3+2", group: "Blitz", base: 180, increment: 2 },
  { id: "blitz_5_0", label: "5+0", group: "Blitz", base: 300, increment: 0 },
  { id: "rapid_10_0", label: "10+0", group: "Rápido", base: 600, increment: 0 },
  { id: "rapid_15_10", label: "15+10", group: "Rápido", base: 900, increment: 10 },
  { id: "classic_30_0", label: "30+0", group: "Clássico", base: 1800, increment: 0 },
  { id: "unlimited", label: "Sem limite", group: "Livre", base: null, increment: 0 },
];

export const AI_TIME_BY_ID: Record<string, AiTimeControl> = AI_TIME_CONTROLS.reduce(
  (acc, t) => ({ ...acc, [t.id]: t }),
  {} as Record<string, AiTimeControl>
);

export const AI_TIME_GROUP_ORDER: TimeGroup[] = [
  "Bullet",
  "Blitz",
  "Rápido",
  "Clássico",
  "Livre",
];

/** Resumo curto para o rodapé do wizard. */
export function timeControlSummary(tc: AiTimeControl): string {
  return tc.base === null ? "Sem limite" : `${tc.group} ${tc.label}`;
}
