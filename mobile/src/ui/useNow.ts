import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** `Date.now()`, re-read every `everyMs` while the app is in front, so a
 *  relative time ("7 min ago") keeps counting on a page left open. No timer
 *  runs behind a dark screen (ADR 0013). */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let tick: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(tick);
      tick = setInterval(() => setNow(Date.now()), everyMs);
    };
    if (AppState.currentState === "active") start();
    const app = AppState.addEventListener("change", (state) => {
      clearInterval(tick);
      if (state !== "active") return;
      setNow(Date.now());
      start();
    });
    return () => {
      clearInterval(tick);
      app.remove();
    };
  }, [everyMs]);
  return now;
}
