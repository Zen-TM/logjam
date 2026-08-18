// Elevation from the DEM: the tiles saved on this phone first, then the public
// tile set over the network.
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
// PRIVACY. The positions are precise wilderness coordinates and the tile
// indices are a coarse location (a z13 tile is ~4.9 km across). Nothing here
// logs either — an unreadable region or a failed fetch is reported as "no
// height", by returning nulls, and a fetch failure is deliberately NOT logged
// because the URL carries the tile indices.
//
// The network path asks AWS's public `elevation-tiles-prod` bucket directly,
// which is the same bucket a region download already fetches from, and it
// needs no account. It is the LAST resort, not the first: `useElevationProfile`
// prefers our own API when signed in, precisely so the tile requests — which
// trace where the user is drawing — go out on the server's connection rather
// than the user's (api/src/services/elevation.ts says the same from the other
// side). This path exists for a guest, who cannot authenticate that call, and
// for a deployed API too old to have the route.
//
// What it reveals when it does run: WHEN you looked, and a ~4.9 km cell.
// Accepted deliberately (operator decision, 2026-08-18) in exchange for
// elevation outside saved regions; the local hit is tried first and tiles are
// cached, so a session in one area is one request. The map's offline-only mode
// suppresses it entirely.
import * as SQLite from "expo-sqlite";
import {
  DEM_TILE_ZOOM,
  demSampleValue,
  demTileUrl,
  resolveDemSamples,
  xyzToTmsRow,
  type SamplePosition,
} from "@logjam/shared";

import { decodeDemPng } from "./demPng";
import { cacheTile, cachedTile, clearDemTileCache } from "./demTileCache";
import { REGION_DIR } from "./localStores";
import { listArtifacts } from "./registryDb";
import { regionFileName } from "./regionMbtiles";

/** expo-sqlite's `directory` argument is a plain path, not a file:// URI. */
const REGION_DIR_PATH = REGION_DIR.replace(/^file:\/\//, "");

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

/** A tile is ~100 KB; this is a tap on a map, not a download. */
const TILE_FETCH_TIMEOUT_MS = 10_000;

/**
 * How many tiles one lookup may fetch.
 *
 * A point needs one and a drawn route a handful, but a long imported line
 * could address dozens, and this is an enrichment nobody asked to pay for.
 * Over the cap the uncovered part simply has no height, which is a state the
 * profile already renders.
 *
 * ponytail: fixed cap, no queue. Raise it if real routes turn out to straddle
 * more than this.
 */
const MAX_TILES_PER_FETCH = 6;

async function fetchDemTile(
  tileX: number,
  tileY: number,
): Promise<Float32Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TILE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(demTileUrl(tileX, tileY), {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return decodeDemPng(new Uint8Array(await response.arrayBuffer()));
  } catch {
    // No signal, a 404 over ocean, a truncated body. All mean "no height",
    // and none is worth a log line that would carry the tile indices.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the DEM at each position: saved regions first, then the public tiles
 * when `allowNetwork` and nothing on disk covers the point. Null where neither
 * can answer — the same answer the server's sampler gives outside the DEM's
 * coverage, and never a zero.
 */
export async function sampleElevations(
  positions: readonly SamplePosition[],
  { allowNetwork = false }: { allowNetwork?: boolean } = {},
): Promise<(number | null)[]> {
  if (positions.length === 0) return [];

  const addresses = resolveDemSamples(positions);
  const needed = new Map<string, { tileX: number; tileY: number }>();
  for (const { tileX, tileY } of addresses) {
    const key = `${tileX}/${tileY}`;
    // A network tile held in memory is not usable while simulating offline, so
    // it counts as missing and the saved regions get asked for it instead.
    if (!cachedTile(key, { allowNetwork })) needed.set(key, { tileX, tileY });
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
        cacheTile(key, tile, "saved");
        needed.delete(key);
      }
    }
  }

  // Whatever the device could not answer, ask the network for — but only what
  // is still missing, so a partly-covered line costs only its uncovered tiles.
  if (allowNetwork && needed.size > 0) {
    const batch = [...needed.values()].slice(0, MAX_TILES_PER_FETCH);
    const fetched = await Promise.all(
      batch.map(async ({ tileX, tileY }) => ({
        key: `${tileX}/${tileY}`,
        tile: await fetchDemTile(tileX, tileY),
      })),
    );
    for (const { key, tile } of fetched) if (tile) cacheTile(key, tile, "network");
  }

  return addresses.map(({ tileX, tileY, index }) =>
    demSampleValue(cachedTile(`${tileX}/${tileY}`, { allowNetwork }), index),
  );
}

/** Saved regions only — the guaranteed-no-network read. */
export async function sampleElevationsOffline(
  positions: readonly SamplePosition[],
): Promise<(number | null)[]> {
  return sampleElevations(positions);
}

/** Dropped on wipe/sign-out: the cache holds terrain around the user's area. */
export function clearOfflineDemCache(): void {
  clearDemTileCache();
}
