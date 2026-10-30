import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { GaugeLatestFile } from "@logjam/shared";

import { subscribeReconnect } from "../map/connectivity";
import { GAUGE_REFRESH_MS, refreshGauges } from "./gaugeFeed";
import { readCachedGauges } from "./gaugeStorage";

/**
 * The gauge file: the phone's kept copy at once, a fresh one when the layer is
 * switched on, when the app returns to the front and when signal returns.
 * Nothing runs while the layer is off.
 */
export function useGauges(enabled: boolean): {
  file: GaugeLatestFile | null;
  /** The first load has finished, so no file means none could be had. */
  settled: boolean;
  /** Moves every five minutes while the app is in front, so a gauge whose
   *  last reading ages out is drawn faint without a fetch. */
  now: number;
} {
  const [file, setFile] = useState<GaugeLatestFile | null>(null);
  const [settled, setSettled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // A fetch can beat the read: keep whichever landed first.
    const read = readCachedGauges().then(
      (kept) => live && setFile((f) => f ?? kept),
    );
    const load = () =>
      refreshGauges().then((fresh) => live && fresh && setFile(fresh));
    void Promise.all([read, load()]).then(() => live && setSettled(true));
    // Only while in front: no timer behind a dark screen (ADR 0013).
    let tick: ReturnType<typeof setInterval> | undefined;
    const startTick = () => {
      clearInterval(tick);
      tick = setInterval(() => setNow(Date.now()), GAUGE_REFRESH_MS);
    };
    if (AppState.currentState === "active") startTick();
    const app = AppState.addEventListener("change", (s) => {
      clearInterval(tick);
      if (s !== "active") return;
      setNow(Date.now());
      startTick();
      void load();
    });
    const unsubscribe = subscribeReconnect(() => void load());
    return () => {
      live = false;
      // A later switch-on starts unsettled, so no failure line shows while it loads.
      setSettled(false);
      clearInterval(tick);
      app.remove();
      unsubscribe();
    };
  }, [enabled]);
  return { file, settled, now };
}
