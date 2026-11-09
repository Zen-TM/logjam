// Keeping the latest weather run with a saved area, so the overlay draws
// offline and says how old it is (ADR 0048). It rides the area's download:
// started by the same press (a save, an update or its Retry), over the same
// connection rule (mobile data only if the user allowed it for this download),
// asked again every CHECK_EVERY files, and not by a timer (ADR 0013). About 420
// small files, about 12 MB, shared by all areas, each run replacing the one
// before; the manifest is written last, so a download that stops, or loses its
// connection, leaves the run before it whole. Guard: weatherMapKeep.test.ts.
import { downloadFromPresignedUrl } from "../api/presignedTransfer";
import { config } from "../config";
import { assertSpaceFor } from "../offline/freeSpace";
import { canRunNow } from "../offline/networkPolicy";
import { weatherMapEpoch } from "./weatherMapEpoch";
import { fetchWeatherManifest } from "./weatherMapFeed";
import { areaTouchesRun, weatherRunUrls } from "./weatherMapRun";
import {
  KEPT_WEATHER_BASE,
  announceKeptWeather,
  dropRunsExcept,
  holdForWipe,
  makeFolderFor,
  readKeptWeather,
  writeKeptManifest,
} from "./weatherMapStorage";

/** Our own CDN, so no politeness envelope: a few at a time is quick, not rude. */
const PARALLEL = 6;
/** The connection rule is asked again after this many files (about one in eight of a run). */
export const CHECK_EVERY = 50;
/** A run is about 12 MB; the margin is for the file system's own rounding. */
const KEEP_BYTES = 16 * 1024 * 1024;

let running: Promise<void> | null = null;

export type SavedArea = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * Resolves when the run is kept or given up on; never rejects. `epoch` is the
 * wipe epoch the caller read before it awaited anything (the dynamic import
 * of this file included): a wipe that lands first must stop this download,
 * not be the epoch it starts in.
 */
export function keepLatestWeather(
  allowCellular: boolean,
  areas: SavedArea[],
  epoch = weatherMapEpoch(),
): Promise<void> {
  running ??= run(allowCellular, areas, epoch)
    .catch(() => {})
    .finally(() => {
      running = null;
    });
  holdForWipe(running);
  return running;
}

async function run(
  allowCellular: boolean,
  areas: SavedArea[],
  epoch: number,
): Promise<void> {
  if (!(await canRunNow("topoDownload", allowCellular))) return;
  const latest = await fetchWeatherManifest(allowCellular);
  if (
    !latest ||
    !areas.some((area) => areaTouchesRun(area, latest.file.bounds))
  )
    return;
  const kept = await readKeptWeather();
  if (kept?.path === latest.file.path || weatherMapEpoch() !== epoch) return;
  await assertSpaceFor(KEEP_BYTES);

  await dropRunsExcept(kept);
  const from = weatherRunUrls(config.topoCdnBaseUrl, latest.file);
  const to = weatherRunUrls(KEPT_WEATHER_BASE, latest.file);
  let next = 0;
  let ok = true;
  const worker = async () => {
    while (ok && next < from.length) {
      const i = next++;
      if (weatherMapEpoch() !== epoch) ok = false;
      else if (
        i > 0 &&
        i % CHECK_EVERY === 0 &&
        !(await canRunNow("topoDownload", allowCellular))
      )
        ok = false;
      else
        try {
          await makeFolderFor(to[i]!);
          const got = await downloadFromPresignedUrl(from[i]!, to[i]!);
          // The download writes the body whatever the status: an error page
          // would be kept as a tile.
          if (got.status !== 200) ok = false;
        } catch {
          ok = false;
        }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (weatherMapEpoch() !== epoch) return;
  if (!ok) return dropRunsExcept(kept);
  await writeKeptManifest(latest.text);
  await dropRunsExcept(latest.file);
  announceKeptWeather();
}
