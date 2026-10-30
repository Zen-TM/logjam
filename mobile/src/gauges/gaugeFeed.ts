// Fetching the public gauge file (ADR 0044). Foreground only (ADR 0013): the
// callers are the layer being switched on, the app returning to the front and
// regained signal, and at most one fetch per five minutes. A gauge's history is
// fetched the same way, only for the gauges a screen or a saved place names.
//
// PRIVACY: the request carries no headers and no query, only the public
// file's path, so every phone sends the same thing. A history's path names its
// gauge, which our own CDN's logs hold without the account (ADR 0044). Guard: gaugeFeed.test.ts
// ("from the CDN with nothing else sent"). A failure is a state, never a log
// line.
import {
  GAUGE_LATEST_PATH,
  gaugeHistoryUrl,
  parseGaugeHistory,
  parseGaugeLatest,
  type GaugeLatestFile,
} from "@logjam/shared";

import { config } from "../config";
import { canRunNow } from "../offline/networkPolicy";
import { isOfflineOnly } from "../offline/offlineOnlyMode";
import {
  cacheGaugeHistory,
  cacheGauges,
  gaugesEpoch,
  readCachedGaugeHistory,
  trackGaugeRefresh,
} from "./gaugeStorage";

export const GAUGE_REFRESH_MS = 5 * 60_000;
const TIMEOUT_MS = 15_000;

let lastOkAt = 0;
/** The wipe epoch of the fetch that set `lastOkAt`: a wipe voids the throttle. */
let lastOkEpoch = 0;
let running: Promise<GaugeLatestFile | null> | null = null;

/** The new file, or null when none was fetched (too soon, no connection,
 *  offline-only mode, a failure or a bad file): the caller keeps what it has,
 *  and a bad file never replaces a good one. */
export function refreshGauges(): Promise<GaugeLatestFile | null> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<GaugeLatestFile | null> {
  if (
    isOfflineOnly() ||
    (lastOkEpoch === gaugesEpoch() && Date.now() - lastOkAt < GAUGE_REFRESH_MS)
  )
    return null;
  // A file of about 300 KB gzipped rides the "sync" setting, which allows
  // mobile data by default, so no row of its own is needed.
  if (!(await canRunNow("sync"))) return null;
  const epoch = gaugesEpoch();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(
      `${config.topoCdnBaseUrl}/${GAUGE_LATEST_PATH}`,
      {
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const text = await response.text();
    const file = parseGaugeLatest(JSON.parse(text));
    if (!file) return null;
    await cacheGauges(text, epoch).catch(() => {});
    lastOkAt = Date.now();
    lastOkEpoch = epoch;
    return file;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const HISTORY_FRESH_MS = 86_400_000;
/** When each gauge's history was last asked for, per wipe epoch, so a 404 or a
 *  failure is not retried at every screen that mounts. */
const askedAt = new Map<string, number>();
let historyTail: Promise<void> = Promise.resolve();

/**
 * Fetches the daily history of these gauges, one at a time, for those with no
 * kept file or one older than a day, and keeps each one that parses; a bad or
 * missing file (a 404 before the job has written it) never replaces a good
 * one. Same foreground callers, debounce and connection policy as the latest
 * file. Resolves when the queue has finished, for the caller to re-read.
 */
export function refreshGaugeHistories(ids: string[]): Promise<void> {
  // The epoch is read once, here: a wipe ends this refresh for good, so
  // nothing of the old account is asked for or written after it.
  const epoch = gaugesEpoch();
  historyTail = historyTail.then(async () => {
    if (isOfflineOnly()) return;
    for (const id of new Set(ids)) {
      if (gaugesEpoch() !== epoch) return;
      const key = `${epoch}:${id}`;
      const url = gaugeHistoryUrl(config.topoCdnBaseUrl, id);
      if (!url || Date.now() - (askedAt.get(key) ?? 0) < GAUGE_REFRESH_MS)
        continue;
      const kept = await readCachedGaugeHistory(id);
      if (kept && kept.ageMs < HISTORY_FRESH_MS) continue;
      if (!(await canRunNow("sync")) || gaugesEpoch() !== epoch) return;
      askedAt.set(key, Date.now());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) continue;
        const text = await response.text();
        if (parseGaugeHistory(JSON.parse(text)))
          await cacheGaugeHistory(id, text, epoch).catch(() => {});
      } catch {
        // Offline or a bad body: the kept file, if any, stays.
      } finally {
        clearTimeout(timer);
      }
    }
  });
  trackGaugeRefresh(historyTail);
  return historyTail;
}

/** For tests. */
export const resetGaugeFeed = (): void => {
  askedAt.clear();
  historyTail = Promise.resolve();
  lastOkAt = 0;
  running = null;
};
