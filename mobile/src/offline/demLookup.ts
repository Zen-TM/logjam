// Elevation from the DEM saved on this phone — the offline half of
// `useElevationProfile`.
//
// Every "save maps offline" run writes a `dem-region` MBTiles of terrarium
// tiles at DEM_TILE_ZOOM (regionTileDownload.ts). This reads them back, so a
// route profile, a point's height and a track's gain/loss keep working in a
// canyon with no signal — the trip the download exists for.
//
// The maths is the server sampler's, imported rather than re-derived
// (shared/src/demTiles.ts): same zoom, same pixel address, same no-data rule,
// so a profile drawn offline matches the one drawn online over the same line.
//
// PRIVACY: the positions are precise wilderness coordinates and the tile
// indices are a coarse location. Nothing here logs either — an unreadable
// region is reported as "no height", by returning nulls.
import * as SQLite from "expo-sqlite";
import {
  DEM_TILE_ZOOM,
  demSampleValue,
  resolveDemSamples,
  xyzToTmsRow,
  type SamplePosition,
} from "@logjam/shared";

import { decodeDemPng } from "./demPng";
import { REGION_DIR } from "./localStores";
import { listArtifacts } from "./registryDb";
import { regionFileName } from "./regionMbtiles";

/** expo-sqlite's `directory` argument is a plain path, not a file:// URI. */
const REGION_DIR_PATH = REGION_DIR.replace(/^file:\/\//, "");

/**
 * Decoded tiles, keyed "x/y" (the zoom is fixed). One is 256 KB of float
 * metres, and a profile re-samples the same handful of tiles on every vertex
 * drag, so this is what keeps dragging a route cheap.
 *
 * Insertion-ordered eviction, like the API's cache: the access pattern is a
 * burst over neighbouring tiles, where true LRU would barely differ.
 */
const MAX_CACHED_TILES = 8;
const tileCache = new Map<string, Float32Array>();

function cacheTile(key: string, tile: Float32Array) {
  if (tileCache.size >= MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next();
    if (!oldest.done) tileCache.delete(oldest.value);
  }
  tileCache.set(key, tile);
}

/** Registry rows are the index of what is on disk; the files are the data. */
async function demArtifactIds(): Promise<string[]> {
  const artifacts = await listArtifacts();
  return artifacts.filter((a) => a.kind === "dem-region").map((a) => a.id);
}

/**
 * Read the wanted tiles out of one saved DEM region.
 *
 * Opened read-only and queried for the whole batch in one pass, because opening
 * an MBTiles per tile would mean an open per profile sample.
 */
async function readTilesFrom(
  artifactId: string,
  wanted: { tileX: number; tileY: number }[],
): Promise<Map<string, Float32Array>> {
  const found = new Map<string, Float32Array>();
  const db = await SQLite.openDatabaseAsync(
    regionFileName(artifactId),
    {},
    REGION_DIR_PATH,
  );
  try {
    // A region download may be writing a sibling file; wait rather than throw.
    await db.execAsync("PRAGMA busy_timeout = 3000;");
    for (const { tileX, tileY } of wanted) {
      const row = await db.getFirstAsync<{ tile_data: Uint8Array }>(
        `SELECT tile_data FROM tiles
         WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?`,
        DEM_TILE_ZOOM,
        tileX,
        xyzToTmsRow(DEM_TILE_ZOOM, tileY),
      );
      if (!row?.tile_data) continue;
      found.set(`${tileX}/${tileY}`, decodeDemPng(row.tile_data));
    }
  } finally {
    await db.closeAsync().catch(() => {});
  }
  return found;
}

/**
 * Read the DEM at each position from what is stored on this device. Null where
 * no saved region covers the point — the same answer the online sampler gives
 * outside the DEM's coverage, and never a zero.
 */
export async function sampleElevationsOffline(
  positions: readonly SamplePosition[],
): Promise<(number | null)[]> {
  if (positions.length === 0) return [];

  const addresses = resolveDemSamples(positions);
  const needed = new Map<string, { tileX: number; tileY: number }>();
  for (const { tileX, tileY } of addresses) {
    const key = `${tileX}/${tileY}`;
    if (!tileCache.has(key)) needed.set(key, { tileX, tileY });
  }

  if (needed.size > 0) {
    for (const artifactId of await demArtifactIds()) {
      if (needed.size === 0) break;
      let found: Map<string, Float32Array>;
      try {
        found = await readTilesFrom(artifactId, [...needed.values()]);
      } catch (err) {
        // One unreadable region must not cost the heights the others hold.
        // (`failureDetail`-free on purpose: the message could carry a path.)
        console.error(err);
        continue;
      }
      for (const [key, tile] of found) {
        cacheTile(key, tile);
        needed.delete(key);
      }
    }
  }

  return addresses.map(({ tileX, tileY, index }) =>
    demSampleValue(tileCache.get(`${tileX}/${tileY}`), index),
  );
}

/** Dropped on wipe/sign-out: the cache holds terrain around the user's area. */
export function clearOfflineDemCache(): void {
  tileCache.clear();
}
