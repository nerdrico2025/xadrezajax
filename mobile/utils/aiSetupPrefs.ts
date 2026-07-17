import { getItem, setItem } from "./storage";
import type { ColorChoice, Difficulty } from "@/constants/aiGame";

// Última configuração de partida vs IA (PR C): pré-seleciona o wizard na
// próxima vez para reduzir toques.

const KEY = "aiSetupPrefs";

export interface AiSetupPrefs {
  difficulty: Difficulty;
  color: ColorChoice;
  timeId: string;
}

export async function loadAiSetupPrefs(): Promise<AiSetupPrefs | null> {
  try {
    const raw = await getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AiSetupPrefs;
  } catch {
    return null;
  }
}

export async function saveAiSetupPrefs(prefs: AiSetupPrefs): Promise<void> {
  try {
    await setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Preferência é conveniência — falha não bloqueia o jogo.
  }
}
