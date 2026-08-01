// MBTiles writer for downloaded raster basemap regions (stage4a-basemaps.md §4).
//
// Same on-disk shape as a Stage 6 GeoPDF import — one raster MBTiles per region,
// TMS row order, `logjam:*` namespaced metadata — but written from JS rather
// than the native rasteriser, because there is no pixel work in this path: the
// bytes arrive off the network already encoded.
//
// THE FILE IS THE CHECKPOINT. A tile is only in the file if its batch
// transaction committed, so a kill mid-download loses at most one batch and the
// next attempt resumes from exactly what is there (§4.4). The plan also spec'd a
// `region_download` progress table for this; it isn't needed — the metadata rows
// already carry the source, bbox and zoom range, so an unfinished file describes
// its own job. `logjam:build_state` present ⇒ incomplete ⇒ never registered as a
// usable artifact.
//
// PRIVACY: these files hold canyon-area coordinates in their `bounds` metadata
// and live in app-private, backup-excluded storage behind the app lock. Never
// log a path or a bbox from here — progress logging is counts and state words.
import * as FileSystem from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { xyzToTmsRow, type OfflineBasemapId, type RegionBbox } from "@logjam/shared";

/** Directory holding both region kinds (Protomaps clips + these pyramids). */
export const REGION_DIR_URI = `${FileSystem.documentDirectory}offline/regions/`;

/** expo-sqlite's `directory` argument is a plain path, not a file:// URI. */
const REGION_DIR_PATH = REGION_DIR_URI.replace(/^file:\/\//, "");

export type RegionTile = { z: number; x: number; y: number; bytes: Uint8Array };

/**
 * Transient resume state, stored as one metadata row and rewritten inside each
 * tile batch's transaction.
 *
 * `gaps` are tiles the provider answered 404 for — uncached area, or a level it
 * never built there. They are not failures and must not be retried on resume, or
 * every resume re-pokes the provider for tiles that do not exist.
 */
export type RegionBuildState = {
  v: 1;
  planHash: string;
  gaps: [z: number, x: number, y: number][];
};

const BUILD_STATE_KEY = "logjam:build_state";

export type RegionMbtiles = {
  db: SQLite.SQLiteDatabase;
  /** Scheme-less absolute path — what the artifact registry stores. */
  path: string;
  uri: string;
};

export function regionFileName(id: string): string {
  return `${id}.mbtiles`;
}

/** Open (creating if absent) the MBTiles for a region job. */
export async function openRegionMbtiles(id: string): Promise<RegionMbtiles> {
  await FileSystem.makeDirectoryAsync(REGION_DIR_URI, { intermediates: true });
  const fileName = regionFileName(id);
  const db = await SQLite.openDatabaseAsync(fileName, {}, REGION_DIR_PATH);
  // WAL + NORMAL while building: many small insert batches. `finalize` flips the
  // journal to DELETE so the finished artifact is a single file with no sidecars
  // for the native MapLibre reader to trip on.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
    CREATE TABLE IF NOT EXISTS tiles (
      zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tile_index
      ON tiles (zoom_level, tile_column, tile_row);
    CREATE UNIQUE INDEX IF NOT EXISTS metadata_name ON metadata (name);
  `);
  return {
    db,
    path: `${REGION_DIR_PATH}${fileName}`,
    uri: `${REGION_DIR_URI}${fileName}`,
  };
}

async function putMetadata(
  db: SQLite.SQLiteDatabase,
  rows: Record<string, string>,
): Promise<void> {
  for (const [name, value] of Object.entries(rows)) {
    await db.runAsync(
      "INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)",
      name,
      value,
    );
  }
}

export async function readRegionMetadata(
  db: SQLite.SQLiteDatabase,
  name: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM metadata WHERE name = ?",
    name,
  );
  return row?.value ?? null;
}

/**
 * Write the metadata a viewer needs plus the build-state marker that says
 * "not finished". Idempotent: resuming an existing file rewrites the same rows.
 */
export async function initRegionMbtiles(
  target: RegionMbtiles,
  spec: {
    label: string;
    basemapId: OfflineBasemapId;
    bbox: RegionBbox;
    zMin: number;
    zMax: number;
    attribution: string;
    planHash: string;
  },
): Promise<void> {
  const { west, south, east, north } = spec.bbox;
  await putMetadata(target.db, {
    name: spec.label,
    // The SIX caches serve MIXED PNG/JPEG. MBTiles can only name one format, so
    // this row is advisory — MapLibre Native decodes raster tiles by content,
    // not by this string.
    format: "png",
    type: "baselayer",
    bounds: `${west},${south},${east},${north}`,
    center: `${(west + east) / 2},${(south + north) / 2},${spec.zMin}`,
    minzoom: String(spec.zMin),
    maxzoom: String(spec.zMax),
    attribution: spec.attribution,
    "logjam:schema": "1",
    "logjam:kind": "basemap-region",
    "logjam:source": spec.basemapId,
  });
  const existing = await readRegionBuildState(target.db);
  if (existing?.planHash !== spec.planHash) {
    // A checkpoint from a different premise (bbox or zoom changed) can't be
    // resumed against this plan. Inserts are idempotent, so the tiles already
    // present are still valid — only the gap list is discarded.
    await writeRegionBuildState(target.db, {
      v: 1,
      planHash: spec.planHash,
      gaps: [],
    });
  }
}

export async function readRegionBuildState(
  db: SQLite.SQLiteDatabase,
): Promise<RegionBuildState | null> {
  const raw = await readRegionMetadata(db, BUILD_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RegionBuildState;
    return parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

async function writeRegionBuildState(
  db: SQLite.SQLiteDatabase,
  state: RegionBuildState,
): Promise<void> {
  await putMetadata(db, { [BUILD_STATE_KEY]: JSON.stringify(state) });
}

/** "z/x/y" keys already in the file, in XYZ terms (the row is stored flipped). */
export async function listRegionTileKeys(
  db: SQLite.SQLiteDatabase,
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{
    zoom_level: number;
    tile_column: number;
    tile_row: number;
  }>("SELECT zoom_level, tile_column, tile_row FROM tiles");
  return new Set(
    rows.map(
      (row) =>
        `${row.zoom_level}/${row.tile_column}/${xyzToTmsRow(row.zoom_level, row.tile_row)}`,
    ),
  );
}

/**
 * One batch of fetched tiles plus the updated gap list, in a single transaction
 * — so the file never claims progress it doesn't have, and a kill between
 * batches leaves a consistent resume point.
 */
export async function writeRegionBatch(
  target: RegionMbtiles,
  tiles: RegionTile[],
  state: RegionBuildState,
): Promise<void> {
  await target.db.withExclusiveTransactionAsync(async (tx) => {
    for (const tile of tiles) {
      await tx.runAsync(
        `INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data)
         VALUES (?, ?, ?, ?)`,
        tile.z,
        tile.x,
        xyzToTmsRow(tile.z, tile.y),
        tile.bytes,
      );
    }
    await tx.runAsync(
      "INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)",
      BUILD_STATE_KEY,
      JSON.stringify(state),
    );
  });
}

export async function countRegionTiles(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM tiles",
  );
  return row?.n ?? 0;
}

/**
 * Sample a few stored blobs and check they start like an image. Cheap integrity
 * check against a provider that answered 200 with an HTML error page — the
 * per-tile content-type check should have caught that, and this is the backstop
 * that runs before the region is declared usable.
 */
export async function sampleRegionTilesLookLikeImages(
  db: SQLite.SQLiteDatabase,
  sampleSize = 10,
): Promise<boolean> {
  const rows = await db.getAllAsync<{ tile_data: Uint8Array }>(
    "SELECT tile_data FROM tiles ORDER BY RANDOM() LIMIT ?",
    sampleSize,
  );
  return rows.every((row) => looksLikeImage(row.tile_data));
}

/** PNG (\x89PNG) or JPEG (\xFF\xD8\xFF) leading bytes. */
export function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const png =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return png || jpeg;
}

/**
 * Drop the build-state marker (the file is now complete), record the gap count
 * for the UI, and flip to a single-file journal.
 */
export async function finalizeRegionMbtiles(
  target: RegionMbtiles,
  gapCount: number,
): Promise<void> {
  await putMetadata(target.db, { "logjam:gap_count": String(gapCount) });
  await target.db.runAsync("DELETE FROM metadata WHERE name = ?", BUILD_STATE_KEY);
  // No VACUUM: an insert-only database has nothing to reclaim.
  await target.db.execAsync("PRAGMA journal_mode = DELETE; PRAGMA optimize;");
}

export async function closeRegionMbtiles(target: RegionMbtiles): Promise<void> {
  await target.db.closeAsync().catch(() => {});
}

export type UnfinishedRegion = {
  id: string;
  label: string;
  basemapId: OfflineBasemapId;
  bbox: RegionBbox;
  zMax: number;
  tilesStored: number;
};

/**
 * Regions left half-downloaded by a previous session (app killed, phone died).
 *
 * Discovered by reading the FILES, not a progress table: a file carrying
 * `logjam:build_state` is by definition incomplete, and its own metadata says
 * which source, area and depth it was for. That is why there is no
 * `region_download` row to keep in step with the disk.
 */
export async function listUnfinishedRegions(): Promise<UnfinishedRegion[]> {
  const dir = await FileSystem.getInfoAsync(REGION_DIR_URI);
  if (!dir.exists) return [];
  const names = await FileSystem.readDirectoryAsync(REGION_DIR_URI);
  const unfinished: UnfinishedRegion[] = [];
  for (const name of names) {
    if (!name.endsWith(".mbtiles")) continue;
    const id = name.replace(/\.mbtiles$/, "");
    const db = await SQLite.openDatabaseAsync(name, {}, REGION_DIR_PATH);
    try {
      if (!(await readRegionBuildState(db))) continue;
      const bounds = await readRegionMetadata(db, "bounds");
      const source = await readRegionMetadata(db, "logjam:source");
      const maxzoom = await readRegionMetadata(db, "maxzoom");
      if (!bounds || !source || !maxzoom) continue;
      const [west, south, east, north] = bounds.split(",").map(Number);
      unfinished.push({
        id,
        label: (await readRegionMetadata(db, "name")) ?? "Offline map region",
        basemapId: source as OfflineBasemapId,
        bbox: { west, south, east, north },
        zMax: Number(maxzoom),
        tilesStored: await countRegionTiles(db),
      });
    } catch (err) {
      // A file we can't read is not a reason to hide the ones we can.
      console.error(err);
    } finally {
      await db.closeAsync().catch(() => {});
    }
  }
  return unfinished;
}

export async function deleteRegionFile(id: string): Promise<void> {
  // An UNFINISHED region is still in WAL mode (finalize is what flips it to
  // DELETE), so if the app was killed its -wal/-shm were never checkpointed
  // away. Deleting only the .mbtiles left them behind, and since
  // listUnfinishedRegions filters on `.endsWith(".mbtiles")` they were
  // invisible to the UI and uncounted in the storage total — tens of MB of
  // orphan for a half-done imagery region.
  const base = `${REGION_DIR_URI}${regionFileName(id)}`;
  for (const uri of [base, `${base}-wal`, `${base}-shm`]) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}
