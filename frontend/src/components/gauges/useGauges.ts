import { useEffect, useState } from "react";
import {
  GAUGE_LATEST_PATH,
  parseGaugeLatest,
  type GaugeLatestFile,
} from "@logjam/shared";

export const GAUGE_REFRESH_MS = 5 * 60_000;

/**
 * The gauge readings: a public file, the same for everyone (ADR 0044), asked
 * for only while something shows them and again every five minutes while the
 * tab is visible. A failed or malformed fetch keeps the last good file.
 */
export function useGauges(enabled: boolean): {
  file: GaugeLatestFile | null;
  failed: boolean;
  /** Epoch ms, renewed with each load, so a panel left open keeps ages true. */
  now: number;
} {
  const [file, setFile] = useState<GaugeLatestFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    let lastAt = 0;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const abort = (controller = new AbortController());
      lastAt = Date.now();
      setNow(lastAt);
      fetch(`/${GAUGE_LATEST_PATH}`, { signal: abort.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (abort.signal.aborted) return;
          const parsed = parseGaugeLatest(json);
          if (parsed) setFile(parsed);
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
  }, [enabled]);
  // Only a first load that failed is said; the 5-minute timer is the retry.
  return { file, failed: enabled && failed && !file, now };
}
