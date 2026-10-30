// Fetching the public gauge file (ADR 0044). Foreground only (ADR 0013): the
// callers are the layer being switched on, the app returning to the front and
// regained signal, and at most one fetch per five minutes.
//
// PRIVACY: the request carries no headers and no query, only the public
// file's path, so every phone sends the same thing. Guard: gaugeFeed.test.ts
// ("from the CDN with nothing else sent"). A failure is a state, never a log
// line.
import {
  GAUGE_LATEST_PATH,
  parseGaugeLatest,
  type GaugeLatestFile,
} from "@logjam/shared";

import { config } from "../config";
import { canRunNow } from "../offline/networkPolicy";
import { isOfflineOnly } from "../offline/offlineOnlyMode";
import { cacheGauges, gaugesEpoch } from "./gaugeStorage";

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

/** For tests. */
export const resetGaugeFeed = (): void => {
  lastOkAt = 0;
  running = null;
};
