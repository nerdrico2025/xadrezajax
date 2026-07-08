import { useCallback, useEffect, useRef } from "react";
import { AudioPlayer, createAudioPlayer } from "expo-audio";
import { loadSoundSettings, isSoundEnabled } from "@/utils/soundSettings";

const SOUNDS = {
  move: require("../assets/sounds/Move.mp3"),
  capture: require("../assets/sounds/Capture.mp3"),
  check: require("../assets/sounds/GenericNotify.mp3"),
  checkmate: require("../assets/sounds/Checkmate.mp3"),
  gameStart: require("../assets/sounds/Confirmation.mp3"),
  gameEnd: require("../assets/sounds/SocialNotify.mp3"),
  error: require("../assets/sounds/Error.mp3"),
} as const;

type SoundKey = keyof typeof SOUNDS;

export function useChessSound() {
  const players = useRef<Partial<Record<SoundKey, AudioPlayer>>>({});

  useEffect(() => {
    loadSoundSettings();
    const keys = Object.keys(SOUNDS) as SoundKey[];
    keys.forEach((key) => {
      players.current[key] = createAudioPlayer(SOUNDS[key]);
    });
    return () => {
      keys.forEach((key) => players.current[key]?.remove());
    };
  }, []);

  const play = useCallback((sound: SoundKey) => {
    if (!isSoundEnabled()) return;
    const player = players.current[sound];
    if (!player) return;
    try {
      player.seekTo(0);
      player.play();
    } catch {}
  }, []);

  return { play };
}
