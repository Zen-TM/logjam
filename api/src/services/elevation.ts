// DEM sampling for route/measure elevation profiles.
//
// WHY SERVER-SIDE. The alternative is each client reading the DEM itself, and
// that costs more than it saves: React Native has no canvas to decode a PNG
// with, MapLibre's queryTerrainElevation only answers for tiles already loaded
// in the viewport (so a route running off-screen reads null), and every device
// would re-fetch the same tiles uncached. Sampling here gives one
// implementation for web and mobile, one warm tile cache, and keeps DEM tile
// requests — which trace out where the user is drawing — on our own
// infrastructure rather than fanning out from their device to a third party.
//
// The DEM is the AWS Open Data terrarium tile set, the same source the web
// map's 3D terrain uses, so a profile agrees with the hills drawn under it.
// Heights are decoded as (R * 256 + G + B / 256) - 32768 metres.
//
// PRIVACY: positions passed in are precise wilderness coordinates. Nothing
// here logs a coordinate, a tile URL, or a tile index — an upstream failure is
// reported by status alone.
import { loadImage, createCanvas } from "canvas";
import type { SamplePosition } from "@logjam/shared";

/**
 * Zoom to read the DEM at. The underlying data over Australia is ~30 m
 * (1-arcsec SRTM), and a z13 tile is ~4.9 km across at this latitude, so its
 * 256 px grid lands near 19 m/px: a little finer than the source, which
 * captures ridge detail without sampling zoom levels that only interpolate.
 * Deeper zooms would also multiply the tile count for no extra truth.
 */
export const DEM_TILE_ZOOM = 13;
const DEM_TILE_SIZE = 256;
const DEM_TILE_URL_BASE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/** Public-domain sources behind the tile set; surfaced with any profile. */
export const DEM_ATTRIBUTION =
  "Elevation: AWS Open Data Terrain Tiles (SRTM, and national datasets)";

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

/** Fractional tile coordinates (Web Mercator / XYZ) for a position. */
function tileCoordinates(lon: number, lat: number, zoom: number) {
  const scale = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      scale,
  };
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
  const response = await fetch(
    `${DEM_TILE_URL_BASE}/${zoom}/${tileX}/${tileY}.png`,
    { signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS) },
  );
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
    elevations[i] =
      data[offset]! * 256 + data[offset + 1]! + data[offset + 2]! / 256 - 32768;
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
  const resolved = positions.map((position) => {
    const { x, y } = tileCoordinates(position.lon, position.lat, DEM_TILE_ZOOM);
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    // Clamp: a position exactly on a tile's far edge floors to size, which
    // would read the first pixel of the next row.
    const pixelX = Math.min(
      DEM_TILE_SIZE - 1,
      Math.floor((x - tileX) * DEM_TILE_SIZE),
    );
    const pixelY = Math.min(
      DEM_TILE_SIZE - 1,
      Math.floor((y - tileY) * DEM_TILE_SIZE),
    );
    return { tileX, tileY, index: pixelY * DEM_TILE_SIZE + pixelX };
  });

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

  return resolved.map(({ tileX, tileY, index }) => {
    const tile = tiles.get(`${tileX}/${tileY}`);
    if (!tile) return null;
    const value = tile[index];
    // Terrarium encodes "no data" as the extreme low of the range; a genuine
    // -32768 m does not exist on Earth.
    return value == null || value <= -32000 ? null : value;
  });
}

/** Test seam — the cache is process-wide and would otherwise leak between tests. */
export function clearDemTileCache() {
  tileCache.clear();
}
