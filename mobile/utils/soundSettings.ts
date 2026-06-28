import { getItem, setItem } from "./storage";

const KEY = "soundEnabled";

let _enabled = true;
let _loaded = false;

export async function loadSoundSettings(): Promise<void> {
  if (_loaded) return;
  const val = await getItem(KEY);
  _enabled = val === null ? true : val === "true";
  _loaded = true;
}

export function isSoundEnabled(): boolean {
  return _enabled;
}

export async function setSoundEnabled(value: boolean): Promise<void> {
  _enabled = value;
  await setItem(KEY, value ? "true" : "false");
}
