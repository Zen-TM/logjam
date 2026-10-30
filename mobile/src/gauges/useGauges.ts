import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { GaugeLatestFile } from "@logjam/shared";

import { subscribeReconnect } from "../map/connectivity";
import { refreshGauges } from "./gaugeFeed";
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
} {
  const [file, setFile] = useState<GaugeLatestFile | null>(null);
  const [settled, setSettled] = useState(false);
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
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") void load();
    });
    const unsubscribe = subscribeReconnect(() => void load());
    return () => {
      live = false;
      app.remove();
      unsubscribe();
    };
  }, [enabled]);
  return { file, settled };
}
