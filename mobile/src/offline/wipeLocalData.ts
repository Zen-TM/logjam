// Erase everything this device holds for the departing user — the single
// function every account-transition path routes through.
//
// It exists because there was more than one of those paths and they disagreed.
// Sign-out called `wipeAllSyncData()` and stopped there, which left
// `logjam-offline.db` (map artifacts, vector and GeoPDF imports, recorded
// tracks and their points, local waypoints), the downloaded MBTiles regions,
// the overlay bundles, the imported files and the media blob cache sitting on
// disk for whoever signed in next. The different-user branch in `useAuth`
// wiped nothing at all — it carried a "Stage 4+: wipe local stores here" TODO
// while the mirror it should have been clearing filled up.
//
// Guest mode is what forced the issue: far more data now lives locally, and a
// guest who links, signs out and hands the phone to a friend must not leave a
// season of canyon coordinates behind. One guard in one place, rather than a
// wipe in each caller that drifts apart again.
//
// **Deliberately not wiped:** device preferences (`logjam-prefs.db`). Theme,
// app-lock and crash-report choices are statements about this handset, not
// about the account, and clearing them would silently disarm a lock the owner
// turned on. The guest-mode preference is cleared by the caller that knows the
// destination state, not here.
//
// **The list of stores is not maintained here.** On-disk trees come from
// `localStores.ts` and mirror tables from `sync/mirrorSchema.ts` — the same
// declarations the producers are built from, because a list kept beside the
// wipe is a list that drifts out of it. That drift is the whole defect class:
// `routes` was added to the schema and not the wipe, GPX exports were written
// to a cache directory nobody had declared, and MapLibre's ambient tile cache
// was never anyone's store at all.
//
// PRIVACY: this IS the privacy boundary between two users of one phone. A
// failure to delete is worth surfacing, so per-store failures are collected and
// returned rather than swallowed — but one failing store never prevents the
// others from being cleared.
import * as FileSystem from "expo-file-system";

import { stopGeoPdfImportRun } from "../geopdf/importRunner";
import { wipeAllSyncData } from "../sync/syncDb";
import { stopTrackRecordingForWipe } from "../tracks/trackRecorder";
import { WIPED_DIRS } from "./localStores";
import { cancelAllRegionDownloads } from "./regionDownloadQueue";
import { getOfflineDb, notifyRegistryChanged } from "./registryDb";

/** Every table in `logjam-offline.db`. `region_download` is dead schema (see
 * mobile/CLAUDE.md) but is cleared anyway — it costs one statement and leaving
 * a known-unused table out of a privacy wipe is how it comes back to bite. */
const OFFLINE_TABLES = [
  "map_artifact",
  "vector_import",
  "geo_pdf_import",
  "track_point",
  "track",
  "waypoint",
  "overlay_enabled",
  "region_download",
  // An unfinished route draft is coordinates through a canyon — the most
  // sensitive shape of data this app holds.
  "route_draft",
] as const;

/**
 * How long a worker gets to stop before the wipe proceeds without it. Both
 * workers check their cancel token at a work-item boundary (a tile, a
 * rasteriser batch), so this is generous; blowing through it is reported as a
 * failed store rather than passed over, because a worker still running is a
 * worker that can re-create what is about to be deleted.
 */
const STOP_TIMEOUT_MS = 10_000;

export type WipeResult = {
  /** Human-readable names of stores that could not be cleared. Empty = clean. */
  failed: string[];
};

/**
 * Clear the sync mirror, the outbox, the offline registry and every on-disk
 * data tree.
 *
 * The caller owns any "you have N unsynced changes" confirmation — this does
 * not ask, and by the time it runs the decision is already made.
 */
export async function wipeAllLocalData(): Promise<WipeResult> {
  const failed: string[] = [];

  // STOP THE PRODUCERS FIRST. A region download or a GeoPDF import running
  // through the wipe re-created the directory the wipe had just deleted and
  // re-inserted its `map_artifact` row — the departing user's bounding box
  // landing in the next user's install AFTER the wipe reported `failed: []`.
  // Both calls also clear the module-level job state (region labels, bboxes,
  // the import's sheet name), which otherwise outlived sign-out for the life
  // of the JS context and rendered on the next account's Saved screen.
  //
  // A live track recording is a producer too: its foreground service keeps
  // delivering fixes into a `track` row this wipe is about to delete, and its
  // in-memory point series is the departing user's location history.
  const stopped = await Promise.all([
    stoppedInTime(cancelAllRegionDownloads()),
    stoppedInTime(stopGeoPdfImportRun()),
    stoppedInTime(stopTrackRecordingForWipe()),
  ]);
  if (stopped.some((ok) => !ok)) failed.push("a download that wouldn't stop");

  // MapLibre's own ambient cache. Every ONLINE basemap and topo tile the
  // previous user browsed is in there keyed by z/x/y — which IS the area they
  // were looking at, at the zoom they were working at (confirmed on device:
  // 13 tile rows survived a full sign-out byte-for-byte). `resetDatabase`
  // deletes the whole mbgl store, ambient cache and any pack alike; this app
  // keeps no MapLibre packs of its own (regions are our MBTiles files).
  try {
    const { OfflineManager } = await import("@maplibre/maplibre-react-native");
    await OfflineManager.resetDatabase();
  } catch (err) {
    console.error(err);
    failed.push("map tile cache");
  }

  // Mirror + outbox + conflict shelf + notifications cache + sync bookkeeping.
  try {
    await wipeAllSyncData();
  } catch (err) {
    console.error(err);
    failed.push("synced data");
  }

  try {
    const db = await getOfflineDb();
    await db.withTransactionAsync(async () => {
      for (const table of OFFLINE_TABLES) {
        await db.runAsync(`DELETE FROM ${table}`);
      }
    });
    notifyRegistryChanged();
  } catch (err) {
    console.error(err);
    failed.push("offline maps and tracks");
  }

  // Files last: the registry rows that point at them are already gone, so a
  // failure here leaves orphaned blobs rather than rows pointing at nothing.
  for (const dir of WIPED_DIRS) {
    try {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    } catch (err) {
      console.error(err);
      failed.push("downloaded files");
    }
  }

  return { failed };
}

/** True when `work` finished on its own; false when the timeout beat it. */
async function stoppedInTime(work: Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.error(err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
