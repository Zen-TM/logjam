import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { GaugeLatestFile } from "@logjam/shared";

import { subscribeReconnect } from "../map/connectivity";
import { GAUGE_REFRESH_MS, refreshGauges } from "./gaugeFeed";
import { readCachedGauges } from "./gaugeStorage";

/**
 * The gauge file of the feed at `feed` (a region's `gauges` prefix): the
 * phone's kept copy at once, a fresh one when something asks for it, when the
 * app returns to the front and when signal returns. Nothing runs while `feed`
 * is null, and a file is only ever returned for the feed it came from.
 */
export function useGauges(feed: string | null): {
  file: GaugeLatestFile | null;
  /** The first load has finished, so no file means none could be had. */
  settled: boolean;
  /** Moves every five minutes while the app is in front, so a gauge whose
   *  last reading ages out is drawn faint without a fetch. */
  now: number;
} {
  const [held, setHeld] = useState<{
    feed: string;
    file: GaugeLatestFile;
  } | null>(null);
  const [settled, setSettled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (feed === null) return;
    let live = true;
    // A fetch can beat the read: keep whichever landed first for this feed.
    const read = readCachedGauges(feed).then(
      (kept) =>
        live &&
        kept &&
        setHeld((h) => (h?.feed === feed ? h : { feed, file: kept })),
    );
    const load = () =>
      refreshGauges(feed).then(
        (fresh) => live && fresh && setHeld({ feed, file: fresh }),
      );
    void Promise.all([read, load()]).then(() => {
      if (!live) return;
      setNow(Date.now());
      setSettled(true);
    });
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
  }, [feed]);
  return { file: held?.feed === feed ? held.file : null, settled, now };
}
