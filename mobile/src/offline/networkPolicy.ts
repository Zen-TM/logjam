// What this phone is allowed to do over mobile data.
//
// Three separate answers, because the three jobs cost wildly different amounts
// and the honest default differs per job:
//
// - GEOPDF auto-download: tens of megabytes per file, Wi-Fi by default.
// - TOPO overlay auto-download: same order or larger, Wi-Fi by default.
// - SYNC: a few kilobytes of JSON, ALLOWED on mobile data by default — that is
//   the behaviour the app has always had, and a queued trip log that waits for
//   Wi-Fi is a trip log that is only on one phone when it matters.
//
// The check is `isConnectionExpensive`, the platform's own answer, not
// `type === "cellular"`: a metered hotspot is Wi-Fi by type and mobile data by
// cost, and the user paying for it is the one this setting is for.
//
// DEVICE-scoped: a data plan belongs to a handset.
//
// PRIVACY: three booleans about this phone's connection.
import NetInfo from "@react-native-community/netinfo";

import { readPref, writePref } from "../prefsDb";

/** The jobs whose data cost the user can govern. */
export type MeteredJob = "geoPdfDownload" | "topoDownload" | "sync";

const KEYS: Record<MeteredJob, string> = {
  geoPdfDownload: "meteredGeoPdfDownload",
  topoDownload: "meteredTopoDownload",
  sync: "meteredSync",
};

/** Per-job default for "may run on mobile data". */
const DEFAULTS: Record<MeteredJob, boolean> = {
  geoPdfDownload: false,
  topoDownload: false,
  sync: true,
};

/** True when this job may run on a metered connection. Synchronous. */
export function isMeteredAllowed(job: MeteredJob): boolean {
  const stored = readPref(KEYS[job]);
  if (stored === "on") return true;
  if (stored === "off") return false;
  return DEFAULTS[job];
}

/** False when the device refused to store it, so the caller can say so. */
export function setMeteredAllowed(job: MeteredJob, allowed: boolean): boolean {
  return writePref(KEYS[job], allowed ? "on" : "off");
}

/**
 * May this job use the connection the phone is on right now?
 *
 * False when there is no connection at all, so a caller gets one answer to
 * "should I start" rather than having to ask twice. Failing to read the state
 * counts as not allowed: starting a tens-of-megabytes download on an unknown
 * connection is the expensive way to be wrong.
 */
export async function canRunNow(job: MeteredJob): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    if (state.isConnected === false) return false;
    if (isMeteredAllowed(job)) return true;
    const details = state.details as { isConnectionExpensive?: boolean } | null;
    return details?.isConnectionExpensive !== true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
