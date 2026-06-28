import { useCallback, useEffect, useRef } from "react";
import { AudioPlayer, createAudioPlayer } from "expo-audio";

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
