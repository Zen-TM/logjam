// What a sign-out wipe takes from this phone, and which of it cannot come back
// from the account: ONE declaration, read by the wipe (`wipeLocalData.ts`),
// by the confirmation that asks first (`signOutConfirm.ts`) and by the guard
// that holds the two together (`wipedStores.test.ts`).
//
// It exists because the confirmation used to be a count of the outbox and
// nothing else, while the wipe also deleted saved map regions, imported
// GeoPDFs, LiDAR topos, recordings not yet backed up and an unfinished route:
// the user was warned about the least of what they were losing. A list kept
// beside the wipe drifts out of it, so every store the wipe deletes is given a
// FATE here, and the guard fails when the wipe gains one without a fate:
//
//   - `loses`: it holds something that exists only on this phone, so the
//     confirmation names it (`Loss`, counted in `signOutCounts.ts`, worded in
//     `signOutConfirm.ts`).
//   - `keeps`: it comes back from the account, is a cache, or is bookkeeping,
//     and says which, so the decision not to name it is on the record.
//
// This file names no filesystem path and imports nothing native, so the guard
// can read it in a plain test process. It does not change what the wipe
// deletes.

/** A kind of device-only data the sign-out confirmation can name. */
export const LOSSES = [
  "unsynced",
  "unresolved",
  "recordings",
  "routeDraft",
  "regions",
  "geoPdfs",
  "topos",
] as const;
export type Loss = (typeof LOSSES)[number];

export type StoreFate = { loses: readonly Loss[] } | { keeps: string };

/**
 * The `local` tables of `logjam.db` (`sync/mirrorSchema.ts`): the ones a mirror
 * reset spares and only a sign-out clears. Every `mirror` table is rebuilt by
 * the next pull, so those need no entry.
 */
export const SYNC_LOCAL_TABLE_FATE: Record<string, StoreFate> = {
  sync_state: {
    keeps: "A sync cursor and a schema version: nothing the user made.",
  },
  outbox: { loses: ["unsynced"] },
  conflict_shelf: { loses: ["unresolved"] },
};

/**
 * Every table in `logjam-offline.db`, with its fate. The wipe clears exactly
 * these (`wipeLocalData.ts`), so a table cannot be wiped without a fate here.
 *
 * There is no "waypoint": Stage 8 made waypoints a synced entity, so they live
 * in logjam.db and go with the mirror. The legacy table is not created on a
 * fresh install any more, so a DELETE naming it would throw "no such table" and
 * take the WHOLE offline wipe down; the wipe DROPs it instead, for the upgraded
 * device that has not run the promotion yet.
 */
export const OFFLINE_TABLE_FATE = {
  map_artifact: { loses: ["regions", "topos", "geoPdfs"] },
  import_view_state: {
    keeps:
      "Whether an import is drawn and where its bytes are: the file itself is a synced row.",
  },
  geo_pdf_import: { loses: ["geoPdfs"] },
  track_point: { loses: ["recordings"] },
  track_point_rejected: { loses: ["recordings"] },
  track: { loses: ["recordings"] },
  overlay_enabled: { keeps: "Which overlays are switched on: a view setting." },
  route_draft: { loses: ["routeDraft"] },
} as const satisfies Record<string, StoreFate>;

/** Every table in `logjam-offline.db`, in the order the wipe clears them. */
export const OFFLINE_TABLES = Object.keys(
  OFFLINE_TABLE_FATE,
) as (keyof typeof OFFLINE_TABLE_FATE)[];

/**
 * The trees `WIPED_DIRS` (`localStores.ts`) deletes, keyed by the name of the
 * constant that declares each.
 */
export const WIPED_DIR_FATE: Record<string, StoreFate> = {
  MEDIA_CACHE_DIR: {
    // Cached server photos come back; an original not yet uploaded is an
    // outbox op, and the confirmation counts that.
    loses: ["unsynced"],
  },
  REGION_DIR: { loses: ["regions"] },
  OVERLAY_DIR: { loses: ["topos"] },
  IMPORTS_DIR: {
    // GeoPDF imports are device-only. The vector imports beside them are
    // synced media rows, which download again.
    loses: ["geoPdfs"],
  },
  RECORDED_TRACK_DIR: {
    // A recording's backup file, waiting to upload: the recording itself, and
    // the upload, which is an outbox op.
    loses: ["recordings", "unsynced"],
  },
  SCRATCH_DIR: { keeps: "Working files, deleted after use." },
  SENSOR_LOG_DIR: {
    keeps:
      "Research logs from a developer toggle that is off by default, with no coordinates in them.",
  },
};
