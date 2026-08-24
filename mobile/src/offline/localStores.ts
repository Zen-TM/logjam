// The ONE declaration of every on-disk tree this app writes, and the single
// place `documentDirectory` / `cacheDirectory` may be named.
//
// It exists for the same reason `sync/mirrorSchema.ts` does. The recurring
// defect on this side of the app is enumeration drift: a store gets added, its
// path literal is written inline at the producer, and nobody adds it to the
// wipe. Track GPX exports landed in `cacheDirectory` and were never wiped or
// even deleted; MapLibre's own ambient tile cache was never in the list at all.
// A list maintained beside the producers drifts from them; a list the producers
// are BUILT from cannot.
//
// `localStores.test.ts` fails when a source file outside this one reaches for a
// filesystem root, so a new store cannot be added without joining this file —
// and joining this file means joining the wipe.
//
// PRIVACY: these trees hold canyon coordinates (regions, imports, route/track
// exports) and photos. `wipeAllLocalData` deleting all of them IS the privacy
// boundary between two users of one phone (mobile/CLAUDE.md).
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
 * Short-lived working files (staged share-sheet PDFs, GPX written out for an
 * attachment). Its own subdirectory rather than `cacheDirectory` itself so the
 * wipe can delete Logjam's scratch without touching other libraries' caches —
 * and so every scratch file is covered by construction rather than by whoever
 * remembers the `finally`.
 */
export const SCRATCH_DIR = `${FileSystem.cacheDirectory}logjam-scratch/`;

/**
 * Bundled Protomaps glyphs and sprites. DELIBERATELY NOT WIPED: identical for
 * every user, account-independent, and re-extracting them costs a first-launch
 * unzip. It is declared here anyway so "not wiped" is a recorded decision
 * rather than an omission.
 */
export const BASEMAP_ASSETS_DIR = `${FileSystem.documentDirectory}basemap-assets/`;

/**
 * Raw sensor logs from the developer-only research logger
 * (modules/logjam-sensors, private/todo/track-accuracy.md). WIPED: the samples
 * describe how one person moved through a canyon for a day, which is location
 * history by another name even though no coordinate is written — so it leaves
 * with the account like everything else.
 */
export const SENSOR_LOG_DIR = `${FileSystem.documentDirectory}sensor-logs/`;

/**
 * Every tree `wipeAllLocalData` deletes. Databases are not here — they are
 * cleared by table, so their files survive with no rows (see wipeLocalData.ts).
 */
export const WIPED_DIRS = [
  MEDIA_CACHE_DIR,
  REGION_DIR,
  OVERLAY_DIR,
  IMPORTS_DIR,
  SCRATCH_DIR,
  SENSOR_LOG_DIR,
] as const;

/** Create the scratch directory if needed and return a URI inside it. */
export async function scratchFileUri(name: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(SCRATCH_DIR, { intermediates: true });
  return `${SCRATCH_DIR}${name}`;
}

let backupExclusionApplied = false;

/**
 * Keep local data out of iCloud backup (mobile/CLAUDE.md privacy mandate: the
 * iOS half of `allowBackup=false`).
 *
 * `NSDocumentDirectory` is backed up by default, which would send the sync
 * mirror, every downloaded region and every imported GeoPDF — canyon names,
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
