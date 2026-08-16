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
// pixel maths, the zoom and the no-data rule are shared so the two agree —
// see shared/src/demTiles.ts.
//
// The DEM is the AWS Open Data terrarium tile set, the same source the web
// map's 3D terrain uses, so a profile agrees with the hills drawn under it.
//
// PRIVACY: positions passed in are precise wilderness coordinates. Nothing
// here logs a coordinate, a tile URL, or a tile index — an upstream failure is
// reported by status alone.
import { loadImage, createCanvas } from "canvas";
import {
  DEM_TILE_URL_TEMPLATE,
  DEM_TILE_ZOOM,
  demMetresFromRgb,
  demSampleValue,
  resolveDemSamples,
  type SamplePosition,
} from "@logjam/shared";

export { DEM_ATTRIBUTION, DEM_TILE_ZOOM } from "@logjam/shared";

const TILE_FETCH_TIMEOUT_MS = 8_000;

/**
 * Decoded tiles held in memory, keyed "z/x/y". One tile is 256×256 float
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
  zoom: number,
  tileX: number,
  tileY: number,
): Promise<Float32Array | null> {
  const url = DEM_TILE_URL_TEMPLATE.replace("{z}", String(zoom))
    .replace("{x}", String(tileX))
    .replace("{y}", String(tileY));
  const response = await fetch(url, {
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
  zoom: number,
  tileX: number,
  tileY: number,
): Promise<Float32Array | null> {
  const key = `${zoom}/${tileX}/${tileY}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const tile = await fetchTile(zoom, tileX, tileY);
  // Absent tiles are not cached: they are rare, and caching a null would need
  // a second map to distinguish "known absent" from "not yet fetched".
  if (tile) cacheTile(key, tile);
  return tile;
}

/**
 * Read the DEM at each position, in order. Null where the DEM has no coverage.
 *
 * Positions are grouped by tile so each tile is fetched at most once per call,
 * which is what makes a 256-sample profile a handful of requests rather than
 * 256.
 */
export async function sampleElevations(
  positions: readonly SamplePosition[],
): Promise<(number | null)[]> {
  if (positions.length === 0) return [];

  // Resolve every position to its tile and in-tile pixel first, so the fetch
  // set is known before any network work starts.
  const resolved = resolveDemSamples(positions);

  const uniqueKeys = [
    ...new Set(resolved.map((r) => `${r.tileX}/${r.tileY}`)),
  ];
  const tiles = new Map<string, Float32Array | null>();
  await Promise.all(
    uniqueKeys.map(async (key) => {
      const [tileX, tileY] = key.split("/").map(Number);
      tiles.set(key, await tileFor(DEM_TILE_ZOOM, tileX!, tileY!));
    }),
  );

  return resolved.map(({ tileX, tileY, index }) =>
    demSampleValue(tiles.get(`${tileX}/${tileY}`), index),
  );
}

/** Test seam — the cache is process-wide and would otherwise leak between tests. */
export function clearDemTileCache() {
  tileCache.clear();
}
