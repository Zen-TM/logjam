// The last river gauge file of each feed on this phone (ADR 0044), under the
// feed's own prefix (a region's `gauges`) so one feed's file is never read as
// another's. It is public and the same for everyone; it is wiped anyway
// because every on-device store joins the wipe (ADR 0006).
import * as FileSystem from "expo-file-system/legacy";
import {
  gaugeHistoryUrl,
  gaugeLatestPath,
  parseGaugeHistory,
  parseGaugeLatest,
  type GaugeHistoryFile,
  type GaugeLatestFile,
} from "@logjam/shared";

import { GAUGES_DIR } from "../offline/localStores";

const latestPath = (feed: string): string =>
  `${GAUGES_DIR}${gaugeLatestPath(feed)}`;

/** A gauge's history path in the feed, or null for an id that is not a gauge id. */
const historyPath = (feed: string, id: string): string | null =>
  gaugeHistoryUrl("", feed, id) && `${GAUGES_DIR}${feed}history/${id}.json`;

/** Sends nothing: it only reads the phone's own file of the feed. */
export async function readCachedGauges(
  feed: string,
): Promise<GaugeLatestFile | null> {
  try {
    return parseGaugeLatest(
      JSON.parse(await FileSystem.readAsStringAsync(latestPath(feed))),
    );
  } catch {
    return null;
  }
}

/** Sends nothing: a gauge's kept history and how long ago it was written,
 *  or null when there is none. */
export async function readCachedGaugeHistory(
  feed: string,
  id: string,
): Promise<{ file: GaugeHistoryFile; ageMs: number } | null> {
  const path = historyPath(feed, id);
  if (!path) return null;
  try {
    const file = parseGaugeHistory(
      JSON.parse(await FileSystem.readAsStringAsync(path)),
    );
    const info = await FileSystem.getInfoAsync(path);
    return file && info.exists
      ? { file, ageMs: Date.now() - info.modificationTime * 1000 }
      : null;
  } catch {
    return null;
  }
}

// A wipe bumps the epoch so a fetch begun before it cannot re-create the
// directory after it (the pattern of weather/weatherStorage.ts).
let epoch = 0;
let tail: Promise<void> = Promise.resolve();

/** Read when a fetch begins; hand back to `cacheGauges` when it lands. */
export const gaugesEpoch = (): number => epoch;

/** Called by the sign-out wipe: a pending write finishes, later ones are
 *  dropped. A history refresh reads the epoch itself and stops before its next
 *  request, so the wipe does not wait for a fetch in flight. */
export function stopGaugesForWipe(): Promise<void> {
  epoch += 1;
  return tail;
}

/** Keeps an already parsed file. A kill mid-write loses only this public
 *  cache, which the next fetch restores. */
export function cacheGauges(
  feed: string,
  text: string,
  fetchEpoch: number,
): Promise<void> {
  return keep(latestPath(feed), text, fetchEpoch);
}

/** Keeps an already parsed history file for the gauge. */
export function cacheGaugeHistory(
  feed: string,
  id: string,
  text: string,
  fetchEpoch: number,
): Promise<void> {
  const path = historyPath(feed, id);
  return path ? keep(path, text, fetchEpoch) : Promise.resolve();
}

function keep(path: string, text: string, fetchEpoch: number): Promise<void> {
  tail = tail.then(async () => {
    if (fetchEpoch !== epoch) return;
    await FileSystem.makeDirectoryAsync(path.slice(0, path.lastIndexOf("/")), {
      intermediates: true,
    });
    await FileSystem.writeAsStringAsync(path, text);
  });
  const done = tail;
  tail = tail.catch(() => {});
  return done;
}
