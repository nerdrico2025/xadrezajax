import type { Difficulty } from "@/components/DifficultyModal";

// Onboarding em 3 toques (item 0.4). O nível é calculado no backend
// (POST /api/v1/auth/onboarding/); aqui fica só o que a UI precisa.

export type OnboardingLevel = "beginner" | "intermediate" | "advanced";
export type OnboardingExperience = "never" | "casual" | "frequent";
export type OnboardingFrequency = "casual" | "weekly" | "daily";

/** Primeira partida vs IA na dificuldade correspondente ao nível calculado. */
export const DIFFICULTY_BY_LEVEL: Record<OnboardingLevel, Difficulty> = {
  beginner: "easy",
  intermediate: "medium",
  advanced: "hard",
};

export const EXPERIENCE_OPTIONS: {
  value: OnboardingExperience;
  label: string;
  icon: string;
}[] = [
  { value: "never", label: "Nunca joguei", icon: "sparkles-outline" },
  { value: "casual", label: "Já joguei casualmente", icon: "cafe-outline" },
  { value: "frequent", label: "Jogo com frequência", icon: "flame-outline" },
];

export const FREQUENCY_OPTIONS: {
  value: OnboardingFrequency;
  label: string;
  icon: string;
}[] = [
  { value: "casual", label: "De vez em quando", icon: "leaf-outline" },
  { value: "weekly", label: "Algumas vezes por semana", icon: "calendar-outline" },
  { value: "daily", label: "Todo dia", icon: "flash-outline" },
];

// Pergunta 2: qual diagrama tem mate em 1 para as brancas?
// Exatamente um dos FENs tem lance de mate — validado por teste com chess.js
// (constants/__tests__/onboarding.test.ts).
export const MATE_DIAGRAMS: { fen: string; isMate: boolean }[] = [
  // Torre em b3: Rb8+ existe, mas o rei escapa para h7 — só xeque
  { fen: "7k/8/8/8/8/1R6/8/6K1 w - - 0 1", isMate: false },
  // Mate do corredor: Ra8# (peões f7/g7/h7 trancam o rei)
  { fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", isMate: true },
  // Bispo em c3: nenhum xeque disponível
  { fen: "6k1/5ppp/8/8/8/2B5/8/6K1 w - - 0 1", isMate: false },
];
