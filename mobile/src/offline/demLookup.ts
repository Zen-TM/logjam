// Elevation from the DEM: the tiles saved on this phone first, then the public
// tile set over the network.
//
// Every "save maps offline" run writes a `dem-region` MBTiles of a DEM
// source's tiles at its `sampleZoom` (regionTileDownload.ts), filed under the
// source's id. This reads them back, so a
// route profile, a point's height and a track's gain/loss keep working in a
// place with no signal — the trip the download exists for.
//
// The sampling is the server's, imported rather than re-derived (`sampleDem`
// in shared/src/demSources.ts): same choice of source, same zoom, same pixel
// address, same no-data rule, so a profile drawn offline matches the one drawn
// online over the same line. This file is only the tile I/O it is handed.
//
// PRIVACY. The positions are precise wilderness coordinates and the tile
// indices are a coarse location (a z13 tile is ~4.9 km across). Nothing here
// logs either — an unreadable region or a failed fetch is reported as "no
// height", by returning nulls, and a fetch failure is deliberately NOT logged
// because the URL carries the tile indices.
//
// The network path asks the source's public tile host directly, which is the
// same host a region download already fetches from, and it needs no account. It is the LAST resort, not the first: `useElevationProfile`
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
  demArchive,
  demTileKey,
  demTileUrl,
  readDemArchive,
  sampleDem,
  xyzToTmsRow,
  type DemSamples,
  type DemSource,
  type DemTileAddress,
  type SamplePosition,
} from "@logjam/shared";

import { config } from "../config";
import { fileSource } from "../map/snapLines";
import type { MapArtifact } from "../map/sourceResolver";
import { decodeDemPng } from "./demPng";
import { cacheTile, cachedTile, clearDemTileCache } from "./demTileCache";
import { REGION_DIR } from "./localStores";
import { listArtifacts } from "./registryDb";
import { regionFileName } from "./regionMbtiles";

/** expo-sqlite's `directory` argument is a plain path, not a file:// URI. */
const REGION_DIR_PATH = REGION_DIR.replace(/^file:\/\//, "");

/** Registry rows are the index of what is on disk; the files are the data. */
async function demArtifacts(source: DemSource): Promise<MapArtifact[]> {
  const artifacts = await listArtifacts();
  return artifacts.filter(
    (a) => a.kind === "dem-region" && a.logicalKey === source.id,
  );
}

/**
 * Read the wanted tiles out of one saved DEM region.
 *
 * A source built into an archive is saved as a PMTiles clip; the worldwide
 * tile set as the MBTiles the tile engine wrote. An MBTiles is opened
 * read-only and queried for the whole batch in one pass, because opening one
 * per tile would mean an open per profile sample.
 */
async function readTilesFrom(
  artifact: MapArtifact,
  source: DemSource,
  wanted: readonly DemTileAddress[],
): Promise<Map<string, Float32Array>> {
  const found = new Map<string, Float32Array>();
  if (artifact.format === "pmtiles") {
    const archive = demArchive(fileSource(artifact.path));
    for (const [key, png] of await readDemArchive(archive, source, wanted))
      found.set(key, decodeDemPng(png));
    return found;
  }
  const zoom = source.sampleZoom;
  const db = await SQLite.openDatabaseAsync(
    regionFileName(artifact.id),
    {},
    REGION_DIR_PATH,
  );
  try {
    await db.execAsync("PRAGMA busy_timeout = 3000;");
    for (const { tileX, tileY } of wanted) {
      const row = await db.getFirstAsync<{ tile_data: Uint8Array }>(
        `SELECT tile_data FROM tiles
         WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?`,
        zoom,
        tileX,
        xyzToTmsRow(zoom, tileY),
      );
      if (!row?.tile_data) continue;
      found.set(demTileKey({ tileX, tileY }), decodeDemPng(row.tile_data));
    }
  } finally {
    await db.closeAsync().catch(() => {});
  }
  return found;
}

/** A tile is ~100 KB; this is a tap on a map, not a download. */
const TILE_FETCH_TIMEOUT_MS = 10_000;

/**
 * How many kilometres of line one lookup may fetch tiles for, as a count of
 * z13 tiles (~4.9 km each); a source read at a deeper zoom gets twice as many
 * per zoom, because a line crosses twice as many.
 *
 * A point needs one and a drawn route a handful, but a long imported line
 * could address dozens, and this is an enrichment nobody asked to pay for.
 * Over the cap the uncovered part simply has no height from this source,
 * which is a state the profile already renders.
 *
 * ponytail: fixed cap, no queue. Raise it if real routes turn out to straddle
 * more than this.
 */
const MAX_TILES_PER_FETCH_Z13 = 6;

/** The public tile set, or our own archive on the CDN: whichever it is. */
async function fetchDemTiles(
  source: DemSource,
  wanted: readonly DemTileAddress[],
): Promise<Map<string, Float32Array>> {
  const found = new Map<string, Float32Array>();
  const batch = wanted.slice(
    0,
    MAX_TILES_PER_FETCH_Z13 * 2 ** Math.max(0, source.sampleZoom - 13),
  );
  const { urlTemplate, archivePath } = source;
  try {
    if (archivePath != null) {
      // Byte ranges of our own file: nothing in the request names a tile.
      const archive = demArchive(`${config.topoCdnBaseUrl}/${archivePath}`);
      for (const [key, png] of await readDemArchive(archive, source, batch))
        found.set(key, decodeDemPng(png));
    } else if (urlTemplate != null) {
      await Promise.all(
        batch.map(async (address) => {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            TILE_FETCH_TIMEOUT_MS,
          );
          try {
            const response = await fetch(
              demTileUrl(
                { ...source, urlTemplate },
                address.tileX,
                address.tileY,
              ),
              { signal: controller.signal },
            );
            if (response.ok)
              found.set(
                demTileKey(address),
                decodeDemPng(new Uint8Array(await response.arrayBuffer())),
              );
          } catch {
            // No height from the network for this tile; not an error to show.
          } finally {
            clearTimeout(timer);
          }
        }),
      );
    }
  } catch {
    // An archive that is not there or will not answer has nothing: the
    // positions fall through to the next source.
  }
  return found;
}

/**
 * The tiles this phone can produce for one source: saved regions first, then
 * the network when `allowNetwork` and nothing on disk has the tile.
 */
async function readTiles(
  source: DemSource,
  wanted: readonly DemTileAddress[],
  allowNetwork: boolean,
): Promise<Map<string, Float32Array>> {
  const cacheKey = (key: string) => `${source.id}/${key}`;
  // Filled as tiles are found, not read back out of the cache at the end: the
  // cache is smaller than a long line's tile count at z15.
  const tiles = new Map<string, Float32Array>();
  const needed = new Map<string, DemTileAddress>();
  for (const address of wanted) {
    const key = demTileKey(address);
    // A network tile held in memory is not usable while simulating offline, so
    // it counts as missing and the saved regions get asked for it instead.
    const cached = cachedTile(cacheKey(key), { allowNetwork });
    if (cached) tiles.set(key, cached);
    else needed.set(key, address);
  }
  const keep = (
    found: Map<string, Float32Array>,
    origin: "saved" | "network",
  ) => {
    for (const [key, tile] of found) {
      cacheTile(cacheKey(key), tile, origin);
      tiles.set(key, tile);
      needed.delete(key);
    }
  };

  if (needed.size > 0) {
    for (const artifact of await demArtifacts(source)) {
      if (needed.size === 0) break;
      try {
        keep(
          await readTilesFrom(artifact, source, [...needed.values()]),
          "saved",
        );
      } catch (err) {
        // One unreadable region must not cost the heights the others hold.
        // (`failureDetail`-free on purpose: the message could carry a path.)
        console.error(err);
      }
    }
  }

  // Whatever the device could not answer, ask the network for — but only what
  // is still missing, so a partly-covered line costs only its uncovered tiles.
  if (allowNetwork && needed.size > 0)
    keep(await fetchDemTiles(source, [...needed.values()]), "network");

  return tiles;
}

/**
 * Read the DEM at each position. Null where neither the phone nor (when
 * `allowNetwork`) the public tiles can answer — the same answer the server's
 * sampler gives outside the DEM's coverage, and never a zero.
 */
export async function sampleElevations(
  positions: readonly SamplePosition[],
  { allowNetwork = false }: { allowNetwork?: boolean } = {},
): Promise<DemSamples> {
  return sampleDem(positions, (source, wanted) =>
    readTiles(source, wanted, allowNetwork),
  );
}

/** Saved regions only — the guaranteed-no-network read. */
export async function sampleElevationsOffline(
  positions: readonly SamplePosition[],
): Promise<DemSamples> {
  return sampleElevations(positions);
}

/** Dropped on wipe/sign-out: the cache holds terrain around the user's area. */
export function clearOfflineDemCache(): void {
  clearDemTileCache();
}
