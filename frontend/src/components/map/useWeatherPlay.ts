import { useEffect, useRef } from "react";
import { WEATHER_MAP } from "@logjam/shared";

/**
 * While `playing`, calls `advance` every `WEATHER_MAP.playMs`. It calls
 * `pause` instead of ticking when the page is hidden, and nothing is armed
 * while paused. `advance` is read when it fires, so a bar that re-renders
 * does not restart the beat. Guard: WeatherBar.test.tsx.
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
    const tick = setInterval(() => latest.current(), WEATHER_MAP.playMs);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [playing, pause]);
}
