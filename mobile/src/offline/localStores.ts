// The ONE declaration of every on-disk tree Logjam GPS writes, and the single
// place `documentDirectory` / `cacheDirectory` may be named.
//
// It exists for the same reason `sync/mirrorSchema.ts` does. The defect this
// guards against is enumeration drift: a store gets added, its path literal is
// written inline at the producer, and nobody adds it to the wipe. A list
// maintained beside the producers drifts from them; a list the producers
// are BUILT from cannot.
//
// `localStores.test.ts` fails when a source file outside this one reaches for a
// filesystem root, so a new store cannot be added without joining this file —
// and joining this file means joining the wipe.
//
// PRIVACY: these trees hold place coordinates (regions, imports, route/track
// exports) and photos. `wipeAllLocalData` deleting all of them IS the privacy
// boundary between two users of one phone (mobile/AGENTS.md, Privacy and battery).
// Guard: `offline/localStores.test.ts`.
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

/** Photos and videos, both cached server media and not-yet-uploaded originals. */
export const MEDIA_CACHE_DIR = `${FileSystem.documentDirectory}media-cache/`;
/** Downloaded MBTiles regions — one file per saved area, bbox in the name of it. */
export const REGION_DIR = `${FileSystem.documentDirectory}offline/regions/`;
/** Topo overlay bundles downloaded for offline use. */
export const OVERLAY_DIR = `${FileSystem.documentDirectory}offline/overlays/`;
/** Imported files: vector sources, and `geopdf/` beneath it. */
export const IMPORTS_DIR = `${FileSystem.documentDirectory}imports/`;
/**
 * GPX serialised from a FINISHED recording, one file per backed-up track.
 *
 * `documentDirectory`, not the scratch: the file is the body of a standalone
 * media row and has to outlive the finish tap — the upload may not run for
 * days if the phone is out of signal, and a cache the OS reclaims in the
 * meantime would leave a media row with nothing to send. Deleted with
 * everything else on an account transition, because a recording is precise
 * location history.
 */
export const RECORDED_TRACK_DIR = `${FileSystem.documentDirectory}recorded-tracks/`;

/**
 * Short-lived working files (staged share-sheet PDFs, GPX written out for an
 * attachment). Its own subdirectory rather than `cacheDirectory` itself so the
 * wipe can delete Logjam's scratch without touching other libraries' caches —
 * and so every scratch file is covered by construction rather than by whoever
 * remembers the `finally`.
 */
export const SCRATCH_DIR = `${FileSystem.cacheDirectory}logjam-scratch/`;

/**
 * The whole cache directory, which `wipeAllLocalData` EMPTIES on sign-out.
 * Not a store of ours — it is the root the OS hands out for
 * disposable scratch, and every library that caches writes into it, including
 * the pickers, which keep their own copy of every photo and file the user
 * attaches. Emptying it names no third-party path, so it cannot drift when a
 * dependency renames its subdirectory, and it catches any leftover files.
 *
 * Not in `WIPED_DIRS`, and not named `*_DIR`, because the wipe EMPTIES it
 * rather than deleting it: the platform owns this directory and libraries write
 * into it without re-creating it. `localStores.test.ts` pins the sweep instead.
 */
export const CACHE_ROOT = FileSystem.cacheDirectory;

/**
 * Bundled Protomaps glyphs and sprites. DELIBERATELY NOT WIPED: identical for
 * every user, account-independent, and re-extracting them costs a first-launch
 * unzip. It is declared here anyway so "not wiped" is a recorded decision
 * rather than an omission.
 */
export const BASEMAP_ASSETS_DIR = `${FileSystem.documentDirectory}basemap-assets/`;

/**
 * The place registry for location search (`offline/placeRegistry.ts`, ADR
 * 0034): the OpenStreetMap file, saved as plain JSON, and the CDN pointer it
 * came with. DELIBERATELY NOT WIPED, for BASEMAP_ASSETS_DIR's reasons: it is
 * the same public file on every phone, holds nothing about the user, and a
 * wipe would only cost the next user the download
 * (PLACE_REGISTRY_DOWNLOAD_ESTIMATE in placeRegistry.ts).
 */
export const PLACE_REGISTRY_DIR = `${FileSystem.documentDirectory}place-registry/`;

/**
 * Raw sensor logs from the developer-only research logger
 * (modules/logjam-sensors). WIPED: each file holds a recording's raw GPS fixes
 * beside how its owner moved, which is location history, so it leaves with the
 * account like everything else.
 */
export const SENSOR_LOG_DIR = `${FileSystem.documentDirectory}sensor-logs/`;

/**
 * The last forecast for each 0.1° cell the user asked about
 * (`weather/weatherStorage.ts`, ADR 0038). WIPED: a cell is where this person
 * went looking, which is location history at 11 km rather than none.
 */
export const WEATHER_DIR = `${FileSystem.documentDirectory}weather/`;

/**
 * The sharpened areas the account could last see, without their URLs
 * (`offline/sharpenedAreaStore.ts`). WIPED: an area's coverage and tile range
 * say where its owner surveyed.
 */
export const SHARPENED_AREAS_DIR = `${FileSystem.documentDirectory}sharpened-areas/`;

/**
 * TileJSONs Logjam GPS writes for map sources MLRN can't describe in props
 * (`map/tileJsonFile.ts`). WIPED: a sharpened area's holds its tile range,
 * which says where its owner surveyed. Each is written again when the map
 * next needs it.
 */
export const TILEJSON_DIR = `${FileSystem.cacheDirectory}logjam-tilejson/`;

/**
 * Every tree `wipeAllLocalData` deletes. Databases are not here — they are
 * cleared by table, so their files survive with no rows (see wipeLocalData.ts).
 */
export const WIPED_DIRS = [
  MEDIA_CACHE_DIR,
  REGION_DIR,
  OVERLAY_DIR,
  IMPORTS_DIR,
  RECORDED_TRACK_DIR,
  SCRATCH_DIR,
  SENSOR_LOG_DIR,
  WEATHER_DIR,
  TILEJSON_DIR,
  SHARPENED_AREAS_DIR,
] as const;

/** Create the scratch directory if needed and return a URI inside it. */
export async function scratchFileUri(name: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(SCRATCH_DIR, { intermediates: true });
  return `${SCRATCH_DIR}${name}`;
}

let backupExclusionApplied = false;

/**
 * Keep local data out of iCloud backup (mobile/AGENTS.md, Privacy and battery:
 * the iOS half of `allowBackup=false`).
 *
 * `NSDocumentDirectory` is backed up by default, which would send the sync
 * mirror, every downloaded region and every imported GeoPDF — place names,
 * coordinates, notes and photos — to Apple. The flag set on the directory
 * covers everything inside it, so one call at startup is the whole fix.
 * Android needs nothing: `app.json` sets `allowBackup: false`.
 */
export async function excludeLocalDataFromBackup(): Promise<void> {
  if (Platform.OS !== "ios" || backupExclusionApplied) return;
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error("No documentDirectory to exclude from backup");
  // Imported here rather than at module scope: nearly every store's producer
  // imports this file, and `requireNativeModule` at load would make all of
  // them depend on the rasteriser module being linked.
  const { default: LogjamPdfRenderer } = await import(
    "../../modules/logjam-pdf-renderer/src/LogjamPdfRendererModule"
  );
  await LogjamPdfRenderer.excludeFromBackup(root);
  backupExclusionApplied = true;
}
