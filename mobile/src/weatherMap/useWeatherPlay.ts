import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { WEATHER_MAP } from "@logjam/shared";

/**
 * While `playing`, calls `advance` every `WEATHER_MAP.playMs`, and only in
 * front: leaving the foreground calls `pause` and clears the interval, and
 * nothing is armed while paused (ADR 0013). `advance` is read when it fires,
 * so a parent that re-renders on every GPS fix does not restart the beat.
 * Guard: batteryRules.test.ts.
 */
export function useWeatherPlay(
  playing: boolean,
  advance: () => void,
  pause: () => void,
) {
  const latest = useRef(advance);
  useEffect(() => {
    latest.current = advance;
  });
  useEffect(() => {
    if (!playing) return;
    let tick: ReturnType<typeof setInterval> | undefined;
    if (AppState.currentState === "active")
      tick = setInterval(() => latest.current(), WEATHER_MAP.playMs);
    else pause();
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      clearInterval(tick);
      pause();
    });
    return () => {
      clearInterval(tick);
      app.remove();
    };
  }, [playing, pause]);
}
