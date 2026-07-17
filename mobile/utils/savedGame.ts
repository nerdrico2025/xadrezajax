import type { Difficulty, PlayerColor } from "@/constants/aiGame";
import { getItem, setItem, removeItem } from "./storage";

const KEY = "savedAiGame";

export interface SavedAiGame {
  fen: string;
  playerCaptures: string[];
  aiCaptures: string[];
  moveCount: number;
  difficulty: Difficulty;
  playerColor: PlayerColor;
}

export async function loadSavedGame(): Promise<SavedAiGame | null> {
  try {
    const data = await getItem(KEY);
    if (!data) return null;
    return JSON.parse(data) as SavedAiGame;
  } catch {
    return null;
  }
}

export async function saveGame(game: SavedAiGame): Promise<void> {
  await setItem(KEY, JSON.stringify(game));
}

export async function clearSavedGame(): Promise<void> {
  await removeItem(KEY);
}
