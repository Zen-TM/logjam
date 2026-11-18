import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { GaugeHistoryFile } from "@logjam/shared";

import { refreshGaugeHistories } from "./gaugeFeed";
import { readCachedGaugeHistory } from "./gaugeStorage";

/**
 * The kept daily history of some gauges of the feed at `feed` at once, refreshed when the screen
 * mounts and when the app returns to the front; offline, the kept files stand.
 * Null until the first read has finished.
 */
export function useGaugeHistories(
  feed: string,
  ids: string[],
): Record<string, GaugeHistoryFile> | null {
  const key = ids.join(",");
  const [found, setFound] = useState<Record<string, GaugeHistoryFile> | null>(
    null,
  );
  useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    let live = true;
    const read = async () => {
      const files = await Promise.all(
        list.map((id) => readCachedGaugeHistory(feed, id)),
      );
      if (live)
        setFound(
          Object.fromEntries(
            list.flatMap((id, i) => (files[i] ? [[id, files[i].file]] : [])),
          ),
        );
    };
    const refresh = () => refreshGaugeHistories(feed, list).then(read);
    void read().then(refresh);
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      live = false;
      app.remove();
    };
  }, [feed, key]);
  return found;
}
