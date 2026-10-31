// The last river gauge file on this phone (ADR 0044). It is public and the
// same for everyone; it is wiped anyway because every on-device store joins
// the wipe (ADR 0006).
import * as FileSystem from "expo-file-system/legacy";
import { parseGaugeLatest, type GaugeLatestFile } from "@logjam/shared";

import { GAUGES_DIR } from "../offline/localStores";

const FILE = `${GAUGES_DIR}latest.json`;

/** Sends nothing: it only reads the phone's own file. */
export async function readCachedGauges(): Promise<GaugeLatestFile | null> {
  try {
    return parseGaugeLatest(
      JSON.parse(await FileSystem.readAsStringAsync(FILE)),
    );
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

/** Called by the sign-out wipe: a pending write finishes, later ones are dropped. */
export function stopGaugesForWipe(): Promise<void> {
  epoch += 1;
  return tail;
}

/** Keeps an already parsed file. A kill mid-write loses only this public
 *  cache, which the next fetch restores. */
export function cacheGauges(text: string, fetchEpoch: number): Promise<void> {
  tail = tail.then(async () => {
    if (fetchEpoch !== epoch) return;
    await FileSystem.makeDirectoryAsync(GAUGES_DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(FILE, text);
  });
  const done = tail;
  tail = tail.catch(() => {});
  return done;
}
