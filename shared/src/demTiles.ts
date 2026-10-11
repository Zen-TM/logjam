// How a DEM tile is read: how a pixel becomes metres, and which pixels a
// coordinate lands on. Which tile sets exist, where they live and how deep
// each is read is `demSources.ts`.
//
// Heights are terrarium-encoded: (R * 256 + G + B / 256) - 32768 metres.
//
// PRIVACY: positions passed through here are precise wilderness coordinates,
// and a tile index is a coarse location. Nothing in this file logs.

import type { SamplePosition } from "./elevation.js";

export const DEM_TILE_SIZE = 256;

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

/** Which tile, and which pixels within it, a position reads from. */
export type DemSampleAddress = {
  tileX: number;
  tileY: number;
  /** Row-major index of the pixel the position falls in. */
  index: number;
  /**
   * The four pixels whose centres surround the position, and how much of the
   * height each contributes (the weights sum to 1). `demSampleHeight` reads
   * these; `index` alone is the stepped, nearest-pixel answer.
   */
  taps: readonly { index: number; weight: number }[];
};

/**
 * Address every position, so a caller knows its whole tile set before fetching
 * (or opening an archive) — that is what makes a 256-sample profile a handful
 * of tile reads rather than 256.
 */
export function resolveDemSamples(
  positions: readonly SamplePosition[],
  zoom: number,
): DemSampleAddress[] {
  const last = DEM_TILE_SIZE - 1;
  return positions.map((position) => {
    const { x, y } = demTileCoordinates(position.lon, position.lat, zoom);
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    // Clamp: a position exactly on a tile's far edge floors to size, which
    // would read the first pixel of the next row.
    const pixelX = Math.min(last, Math.floor((x - tileX) * DEM_TILE_SIZE));
    const pixelY = Math.min(last, Math.floor((y - tileY) * DEM_TILE_SIZE));

    // A pixel's height belongs to its centre, so the neighbours to blend are
    // the ones either side of the position measured from centres (hence -0.5).
    //
    // ponytail: the blend stays inside this tile. Within half a pixel of a
    // tile edge the neighbour is in the next tile, and reading it would add a
    // tile fetch per edge for ~8 m of a 4.9 km tile; the edge pixel is held
    // instead. Read across tiles if a seam ever shows in a profile.
    const centreX = (x - tileX) * DEM_TILE_SIZE - 0.5;
    const centreY = (y - tileY) * DEM_TILE_SIZE - 0.5;
    const x0 = Math.min(last, Math.max(0, Math.floor(centreX)));
    const y0 = Math.min(last, Math.max(0, Math.floor(centreY)));
    const x1 = Math.min(last, x0 + 1);
    const y1 = Math.min(last, y0 + 1);
    const u = Math.min(1, Math.max(0, centreX - x0));
    const v = Math.min(1, Math.max(0, centreY - y0));
    return {
      tileX,
      tileY,
      index: pixelY * DEM_TILE_SIZE + pixelX,
      taps: [
        { index: y0 * DEM_TILE_SIZE + x0, weight: (1 - u) * (1 - v) },
        { index: y0 * DEM_TILE_SIZE + x1, weight: u * (1 - v) },
        { index: y1 * DEM_TILE_SIZE + x0, weight: (1 - u) * v },
        { index: y1 * DEM_TILE_SIZE + x1, weight: u * v },
      ],
    };
  });
}

/** Terrarium pixel → metres above sea level. */
export function demMetresFromRgb(
  red: number,
  green: number,
  blue: number,
): number {
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

/**
 * The height at a position: its four surrounding pixels blended by distance,
 * or null where the tile has nothing there.
 *
 * Blended rather than read from the one pixel the position falls in, because
 * a line crossing a pixel edge would otherwise step by the whole difference
 * between two ~19 m posts, and gain and loss are sums of exactly those steps.
 * Measured on a recorded gorge descent: 57 m of climb that was not there.
 *
 * A no-data neighbour is left out and the rest re-weighted, so the edge of
 * coverage reads the heights it has instead of going null a pixel early.
 */
export function demSampleHeight(
  tile: Float32Array | null | undefined,
  address: DemSampleAddress,
): number | null {
  let sum = 0;
  let weight = 0;
  for (const tap of address.taps) {
    const value = demSampleValue(tile, tap.index);
    if (value == null) continue;
    sum += value * tap.weight;
    weight += tap.weight;
  }
  return weight > 0 ? sum / weight : null;
}
