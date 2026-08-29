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
export type MeteredJob = "geoPdfDownload" | "topoDownload" | "sync" | "mediaUpload";

const KEYS: Record<MeteredJob, string> = {
  geoPdfDownload: "meteredGeoPdfDownload",
  topoDownload: "meteredTopoDownload",
  sync: "meteredSync",
  // MOT-006: media PUTs ride this op, not `sync` — up to 30 MB an image, 500
  // MB a video, nothing like the "a few kilobytes of JSON" `sync` was sized
  // for.
  mediaUpload: "meteredMediaUpload",
};

/** Per-job default for "may run on mobile data". */
const DEFAULTS: Record<MeteredJob, boolean> = {
  geoPdfDownload: false,
  topoDownload: false,
  sync: true,
  mediaUpload: false,
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

/** The shape of a NetInfo state this module's rule actually reads. */
export type ConnectionState = {
  isConnected?: boolean | null;
  type?: string;
  details?: unknown;
};

/**
 * Meteredness exactly as the platform reported it — including "it didn't say".
 *
 * `true` = costs money, `false` = definitely free, `null` = no answer (the
 * property is absent, or there are no details at all because there is no
 * connection). MAPP-002 needs the third: only a definite `false` may hard-block
 * a too-old build, because the user standing in a canyon on a hotspot has to
 * keep their maps and their in-progress track. Every OTHER caller here wants
 * the collapse below, so both live in this file rather than one being derived
 * at each call site.
 */
export function meteredness(state: ConnectionState): boolean | null {
  const details = state.details as { isConnectionExpensive?: unknown } | null | undefined;
  return typeof details?.isConnectionExpensive === "boolean"
    ? details.isConnectionExpensive
    : null;
}

/** True when the platform says this connection costs the user money. */
export function isExpensive(state: ConnectionState): boolean {
  return meteredness(state) === true;
}

/**
 * THE RULE, as a pure function of the state — the one every metered job asks.
 *
 * It is a function rather than four copies of the same `if` because it was four
 * copies of the same `if` and one of them said something else: the region
 * downloader — the single largest data cost in the app — gated on
 * `type === "wifi"`, so a metered hotspot (Wi-Fi by type, mobile data by cost)
 * downloaded tens of megabytes at full pace with the "Use mobile data" toggle
 * never even shown.
 */
export function connectionAllowsMetered(
  state: ConnectionState,
  allowMetered: boolean,
): boolean {
  if (state.isConnected === false) return false;
  if (allowMetered) return true;
  return !isExpensive(state);
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
    return connectionAllowsMetered(await NetInfo.fetch(), isMeteredAllowed(job));
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Connection changes, for a caller that must RE-DECIDE rather than re-ask.
 *
 * Here, not in the caller, for the same reason as everything else in this file:
 * NetInfo is imported in one place. MAPP-002's upgrade gate subscribes because
 * a user warned on mobile data has to escalate to the hard block the moment
 * they reach an unmetered connection, and the server's min-version answer has
 * not changed — only the connection has, so re-fetching would be the wrong
 * question. Returns the unsubscribe.
 */
export function subscribeConnection(
  listener: (state: ConnectionState) => void,
): () => void {
  return NetInfo.addEventListener(listener);
}
