// Keeping the latest weather run with a saved area, so the overlay draws
// offline and says how old it is (ADR 0048). It rides the area's download:
// started by the same press, over the same connection rule (mobile data only
// if the user allowed it for this download), and not by a timer or a retry
// (ADR 0013). About 420 small files, about 12 MB, shared by all areas, each run
// replacing the one before; the manifest is written last, so a download that
// stops leaves the run before it whole. Guard: weatherMapKeep.test.ts.
import { downloadFromPresignedUrl } from "../api/presignedTransfer";
import { config } from "../config";
import { canRunNow } from "../offline/networkPolicy";
import { fetchWeatherManifest } from "./weatherMapFeed";
import { areaTouchesRun, weatherRunUrls } from "./weatherMapRun";
import {
  KEPT_WEATHER_BASE,
  announceKeptWeather,
  dropRunsExcept,
  holdForWipe,
  makeFolderFor,
  readKeptWeather,
  weatherMapEpoch,
  writeKeptManifest,
} from "./weatherMapStorage";

/** Our own CDN, so no politeness envelope: a few at a time is quick, not rude. */
const PARALLEL = 6;

let running: Promise<void> | null = null;

export type SavedArea = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Resolves when the run is kept or given up on; never rejects. */
export function keepLatestWeather(
  allowCellular: boolean,
  area: SavedArea,
): Promise<void> {
  // The epoch is read here, before anything awaits: a wipe that lands first
  // must stop this download, not be the epoch it starts in.
  running ??= run(allowCellular, area, weatherMapEpoch())
    .catch(() => {})
    .finally(() => {
      running = null;
    });
  holdForWipe(running);
  return running;
}

async function run(
  allowCellular: boolean,
  area: SavedArea,
  epoch: number,
): Promise<void> {
  if (!(await canRunNow("topoDownload", allowCellular))) return;
  const latest = await fetchWeatherManifest();
  if (!latest || !areaTouchesRun(area, latest.file.bounds)) return;
  const kept = await readKeptWeather();
  if (kept?.path === latest.file.path || weatherMapEpoch() !== epoch) return;

  await dropRunsExcept(kept);
  const from = weatherRunUrls(config.topoCdnBaseUrl, latest.file);
  const to = weatherRunUrls(KEPT_WEATHER_BASE, latest.file);
  let next = 0;
  let ok = true;
  const worker = async () => {
    while (ok && next < from.length) {
      const i = next++;
      if (weatherMapEpoch() !== epoch) ok = false;
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
