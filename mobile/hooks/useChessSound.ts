import { useCallback, useEffect, useRef } from "react";
import { AudioPlayer, createAudioPlayer } from "expo-audio";

// Adicione os arquivos em mobile/assets/sounds/:
// move.mp3      — movimento normal de peça
// capture.mp3   — captura de peça
// check.mp3     — xeque
// checkmate.mp3 — xeque-mate
const SOUNDS = {
  move: require("../assets/sounds/move.mp3"),
  capture: require("../assets/sounds/capture.mp3"),
  check: require("../assets/sounds/check.mp3"),
  checkmate: require("../assets/sounds/checkmate.mp3"),
} as const;

type SoundKey = keyof typeof SOUNDS;

export function useChessSound() {
  const players = useRef<Partial<Record<SoundKey, AudioPlayer>>>({});

  useEffect(() => {
    const keys = Object.keys(SOUNDS) as SoundKey[];
    keys.forEach((key) => {
      players.current[key] = createAudioPlayer(SOUNDS[key]);
    });

    return () => {
      keys.forEach((key) => players.current[key]?.remove());
    };
  }, []);

  const play = useCallback((sound: SoundKey) => {
    const player = players.current[sound];
    if (!player) return;
    player.seekTo(0);
    player.play();
  }, []);

  return { play };
}
