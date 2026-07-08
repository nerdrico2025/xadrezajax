import { useCallback, useEffect, useRef, useState } from "react";

export type ClockColor = "w" | "b";

export function useChessClock(timeControlSecs: number | null, onTimeout?: (color: ClockColor) => void) {
  const hasTime = timeControlSecs !== null;
  const initialMs = hasTime ? timeControlSecs * 1000 : null;

  const [whiteMs, setWhiteMs] = useState<number | null>(initialMs);
  const [blackMs, setBlackMs] = useState<number | null>(initialMs);
  const [active, setActive] = useState<ClockColor | null>(null);

  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!hasTime || active === null) { clearTick(); return; }

    clearTick();
    intervalRef.current = setInterval(() => {
      const setter = active === "w" ? setWhiteMs : setBlackMs;
      setter((prev) => {
        if (prev === null) return null;
        const next = Math.max(0, prev - 100);
        if (next === 0) onTimeoutRef.current?.(active);
        return next;
      });
    }, 100);

    return clearTick;
  }, [active, hasTime, clearTick]);

  const switchTurn = useCallback((color: ClockColor) => setActive(color), []);
  const pause = useCallback(() => setActive(null), []);

  const reset = useCallback(() => {
    clearTick();
    setWhiteMs(initialMs);
    setBlackMs(initialMs);
    setActive(null);
  }, [initialMs, clearTick]);

  // For online games: snap to server-provided times
  const syncTimes = useCallback((wMs: number | null, bMs: number | null) => {
    if (wMs !== null) setWhiteMs(wMs);
    if (bMs !== null) setBlackMs(bMs);
  }, []);

  return { whiteMs, blackMs, active, switchTurn, pause, reset, syncTimes };
}
