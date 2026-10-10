// DEM sampling for route/measure elevation profiles — the ONLINE reader.
//
// WHY SERVER-SIDE WHEN ONLINE. MapLibre's queryTerrainElevation only answers
// for tiles already loaded in the viewport (so a route running off-screen reads
// null), and every device would otherwise re-fetch the same tiles uncached.
// Sampling here gives one warm tile cache for web and mobile alike, and keeps
// DEM tile requests — which trace out where the user is drawing — off the
// user's own connection while they have ours to use.
//
// It is no longer the only reader. A phone with a downloaded region samples the
// same tiles locally, out of the MBTiles the region download wrote
// (mobile/src/offline/demLookup.ts); that path fetches the tiles direct from S3
// at download time, exactly as the raster basemap download already does. The
// choice of source, the pixel maths, the zoom and the no-data rule are shared
// so the two agree: `sampleDem` in shared/src/demSources.ts. This file is only
// the tile I/O it is handed.
//
// PRIVACY: positions passed in are precise wilderness coordinates. Nothing
// here logs a coordinate, a tile URL, or a tile index — an upstream failure is
// reported by status alone.
import { loadImage, createCanvas } from "canvas";
import {
  demMetresFromRgb,
  demTileKey,
  demTileUrl,
  sampleDem,
  type DemSamples,
  type DemSource,
  type DemTileAddress,
  type SamplePosition,
} from "@logjam/shared";

const TILE_FETCH_TIMEOUT_MS = 8_000;

/**
 * Decoded tiles held in memory, keyed "source/x/y". One tile is 256×256 float
 * metres — 256 KB — so this ceiling is ~16 MB, and the whole Blue Mountains
 * is a couple of dozen tiles. Insertion-ordered eviction (a Map iterates in
 * insertion order, so the first key is the oldest) rather than true LRU:
 * ponytail — the access pattern is a burst of neighbouring tiles per request,
 * where the two orders barely differ. Revisit only if the hit rate is measured
 * and found wanting.
 */
const MAX_CACHED_TILES = 64;
const tileCache = new Map<string, Float32Array>();

function cacheTile(key: string, tile: Float32Array) {
  if (tileCache.size >= MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next();
    if (!oldest.done) tileCache.delete(oldest.value);
  }
  tileCache.set(key, tile);
}

/**
 * Fetch and decode one DEM tile into a flat row-major array of metres.
 *
 * Returns null when the tile does not exist (outside the DEM's coverage) —
 * that is a real answer, not a failure. Anything else throws: a network blip
 * or a 500 upstream must not masquerade as "no terrain here", which would
 * silently render a flat profile over real mountains.
 */
async function fetchTile(
  source: DemSource,
  tileX: number,
  tileY: number,
): Promise<Float32Array | null> {
  const response = await fetch(demTileUrl(source, tileX, tileY), {
    signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    // Status only — never the URL, which carries the tile index and so the
    // rough location being sampled.
    throw new Error(`DEM tile request failed with status ${response.status}`);
  }

  const image = await loadImage(Buffer.from(await response.arrayBuffer()));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);

  const elevations = new Float32Array(image.width * image.height);
  for (let i = 0; i < elevations.length; i++) {
    const offset = i * 4;
    elevations[i] = demMetresFromRgb(
      data[offset]!,
      data[offset + 1]!,
      data[offset + 2]!,
    );
  }
  return elevations;
}

async function tileFor(
  source: DemSource,
  tileX: number,
  tileY: number,
): Promise<Float32Array | null> {
  const key = `${source.id}/${tileX}/${tileY}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const tile = await fetchTile(source, tileX, tileY);
  // Absent tiles are not cached: they are rare, and caching a null would need
  // a second map to distinguish "known absent" from "not yet fetched".
  if (tile) cacheTile(key, tile);
  return tile;
}

/** Each tile is fetched at most once per call, and held for the next. */
async function readTiles(
  source: DemSource,
  wanted: readonly DemTileAddress[],
): Promise<Map<string, Float32Array>> {
  const tiles = new Map<string, Float32Array>();
  await Promise.all(
    wanted.map(async (address) => {
      const tile = await tileFor(source, address.tileX, address.tileY);
      if (tile) tiles.set(demTileKey(address), tile);
    }),
  );
  return tiles;
}

/** Read the DEM at each position, in order. Null where no source has it. */
export function sampleElevations(
  positions: readonly SamplePosition[],
): Promise<DemSamples> {
  return sampleDem(positions, readTiles);
}

/** Test seam — the cache is process-wide and would otherwise leak between tests. */
export function clearDemTileCache() {
  tileCache.clear();
}
