// The DEM tile set itself: where it lives, how deep it is read, how a pixel
// becomes metres, and which pixel a coordinate lands on.
//
// Split out of the API's sampler so there is ONE definition of those four
// things. The mobile app now reads the same tiles from an offline archive
// (mobile/src/offline/demLookup.ts) and the region downloader fetches them at
// exactly the zoom the sampler will later ask for — two readers, one zoom
// constant, so an offline region can never be built at a depth the sampler
// cannot use.
//
// Heights are terrarium-encoded: (R * 256 + G + B / 256) - 32768 metres.
//
// PRIVACY: positions passed through here are precise wilderness coordinates,
// and a tile index is a coarse location. Nothing in this file logs.

import type { SamplePosition } from "./elevation.js";

/**
 * Zoom to read the DEM at. The underlying data over Australia is ~30 m
 * (1-arcsec SRTM), and a z13 tile is ~4.9 km across at this latitude, so its
 * 256 px grid lands near 19 m/px: a little finer than the source, which
 * captures ridge detail without sampling zoom levels that only interpolate.
 * Deeper zooms would also multiply the tile count for no extra truth.
 */
export const DEM_TILE_ZOOM = 13;

export const DEM_TILE_SIZE = 256;

export const DEM_TILE_URL_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/**
 * Credit for the tile set, required by its terms and shown wherever elevation
 * derived from it reaches the user: the web map's terrain source, the mobile
 * map-data sheet, and the `attribution` on every profile response.
 *
 * Two spellings of one credit — MapLibre renders HTML in a source's
 * `attribution`, React Native and JSON responses do not.
 */
/**
 * The tile URL for an address in the public set.
 *
 * The y is the XYZ row, NOT the TMS row an MBTiles store flips to. Getting
 * that wrong does not error: it returns a valid tile for somewhere else, and
 * the caller shows a confident height from the wrong place.
 */
export function demTileUrl(tileX: number, tileY: number): string {
  return DEM_TILE_URL_TEMPLATE.replace("{z}", String(DEM_TILE_ZOOM))
    .replace("{x}", String(tileX))
    .replace("{y}", String(tileY));
}

export const DEM_ATTRIBUTION =
  "Terrain data: Terrain Tiles (Mapzen / Tilezen), via AWS Open Data.";

export const DEM_ATTRIBUTION_HTML =
  'Terrain data: <a href="https://registry.opendata.aws/terrain-tiles">Terrain Tiles</a> (Mapzen / Tilezen).';

/** Fractional tile coordinates (Web Mercator / XYZ) for a position. */
export function demTileCoordinates(
  lon: number,
  lat: number,
  zoom: number,
): { x: number; y: number } {
  const scale = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      scale,
  };
}

/** Which tile, and which pixel within it, a position reads from. */
export type DemSampleAddress = {
  tileX: number;
  tileY: number;
  /** Row-major index into a decoded DEM_TILE_SIZE² tile. */
  index: number;
};

/**
 * Address every position, so a caller knows its whole tile set before fetching
 * (or opening an archive) — that is what makes a 256-sample profile a handful
 * of tile reads rather than 256.
 */
export function resolveDemSamples(
  positions: readonly SamplePosition[],
): DemSampleAddress[] {
  return positions.map((position) => {
    const { x, y } = demTileCoordinates(position.lon, position.lat, DEM_TILE_ZOOM);
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
}

/** Terrarium pixel → metres above sea level. */
export function demMetresFromRgb(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32768;
}

/**
 * One height out of a decoded tile, or null where there is none.
 *
 * Terrarium encodes "no data" as the extreme low of the range; a genuine
 * -32768 m does not exist on Earth. A missing tile is the same answer as a
 * no-data pixel — "we don't know here" — never a zero.
 */
export function demSampleValue(
  tile: Float32Array | null | undefined,
  index: number,
): number | null {
  if (!tile) return null;
  const value = tile[index];
  return value == null || value <= -32000 ? null : value;
}
