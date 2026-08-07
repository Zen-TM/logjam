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
// PRIVACY: this IS the privacy boundary between two users of one phone. A
// failure to delete is worth surfacing, so per-store failures are collected and
// returned rather than swallowed — but one failing store never prevents the
// others from being cleared.
import * as FileSystem from "expo-file-system";

import { wipeAllSyncData } from "../sync/syncDb";
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

/** On-disk trees holding user content. `basemap-assets/` is deliberately absent:
 * it holds generic Protomaps glyphs and sprites, identical for every user. */
const DATA_DIRS = [
  `${FileSystem.documentDirectory}media-cache/`,
  `${FileSystem.documentDirectory}offline/regions/`,
  `${FileSystem.documentDirectory}offline/overlays/`,
  `${FileSystem.documentDirectory}imports/`,
];

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
  for (const dir of DATA_DIRS) {
    try {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    } catch (err) {
      console.error(err);
      failed.push("downloaded files");
    }
  }

  return { failed };
}
