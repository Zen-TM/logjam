import { useEffect, useState } from "react";
import {
  gaugeLatestPath,
  parseGaugeLatest,
  type GaugeLatestFile,
} from "@logjam/shared";

export const GAUGE_REFRESH_MS = 5 * 60_000;

/**
 * The gauge readings of the feed at `feed` (a region's `gauges` prefix): a
 * public file, the same for everyone (ADR 0044), asked for only while
 * something shows them and again every five minutes while the tab is visible.
 * A failed or malformed fetch keeps the last good file. A null `feed` asks for
 * nothing; a file is only ever returned for the feed it came from (guard:
 * `gauges.test.tsx`, "never shows one feed's file as another's").
 */
export function useGauges(feed: string | null): {
  file: GaugeLatestFile | null;
  failed: boolean;
  /** Epoch ms, renewed with each load, so a panel left open keeps ages true. */
  now: number;
} {
  // The feed it came from rides with the file, so a file is never read as
  // another feed's (guard: `gauges.test.tsx`, "never shows one feed's file as
  // another's").
  const [kept, setKept] = useState<{
    feed: string;
    file: GaugeLatestFile;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (feed === null) return;
    let lastAt = 0;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const abort = (controller = new AbortController());
      lastAt = Date.now();
      setNow(lastAt);
      fetch(`/${gaugeLatestPath(feed)}`, { signal: abort.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (abort.signal.aborted) return;
          const parsed = parseGaugeLatest(json);
          if (parsed) setKept({ feed, file: parsed });
          setFailed(!parsed);
        })
        .catch(() => {
          if (!abort.signal.aborted) setFailed(true);
        });
    };
    const visible = () => document.visibilityState === "visible";
    const tick = () => {
      if (visible()) load();
    };
    const onVisible = () => {
      if (visible() && Date.now() - lastAt >= GAUGE_REFRESH_MS) load();
    };
    load();
    const timer = setInterval(tick, GAUGE_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller?.abort();
      setFailed(false);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [feed]);
  // Only a first load that failed is said; the 5-minute timer is the retry.
  const file = kept && kept.feed === feed ? kept.file : null;
  return { file, failed: feed !== null && failed && !file, now };
}
