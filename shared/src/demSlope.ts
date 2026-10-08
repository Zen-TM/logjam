// Slope of the ground at a point, from the DEM around it.
//
// Pure, and split in two so each client keeps its own tile reader: a caller
// asks `demSlopeWindow` which nine heights it needs, reads them with whatever
// sampler it already has (they are ordinary sample positions, so a window that
// straddles a tile edge needs nothing special), and hands them to
// `slopeDegrees`.
//
// WHAT THE NUMBER MEANS. It is the slope of a plane fitted across three DEM
// pixels each way, so it is an average over the window and never the steepest
// thing inside it. It can only be as true as the DEM it is read from: a drop
// narrower than the window, or one the DEM never resolved, comes out gentle.
// Whoever shows it owes the user that caveat.
//
// PRIVACY: positions here are precise wilderness coordinates. Nothing logs.

import {
  DEM_TILE_SIZE,
  DEM_TILE_ZOOM,
  demTileCoordinates,
} from "./demTiles.js";
import type { SamplePosition } from "./elevation.js";

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export type DemSlopeWindow = {
  /** Nine pixel centres, row-major from the north-west; index 4 is the tap. */
  positions: SamplePosition[];
  /** Ground distance between neighbouring positions, the same both ways. */
  cellM: number;
};

/** The 3×3 block of DEM pixels centred on the pixel a position falls in. */
export function demSlopeWindow(lon: number, lat: number): DemSlopeWindow {
  const pixelsAcross = 2 ** DEM_TILE_ZOOM * DEM_TILE_SIZE;
  const tile = demTileCoordinates(lon, lat, DEM_TILE_ZOOM);
  const centreX = Math.floor(tile.x * DEM_TILE_SIZE) + 0.5;
  const centreY = Math.floor(tile.y * DEM_TILE_SIZE) + 0.5;

  const positions: SamplePosition[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = (centreX + dx) / pixelsAcross;
      const y = (centreY + dy) / pixelsAcross;
      positions.push({
        lon: x * 360 - 180,
        lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
        distanceM: 0,
      });
    }
  }
  // Web Mercator is conformal, so a pixel is as tall on the ground as it is
  // wide: one cell size serves both axes.
  const cellM =
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / pixelsAcross;
  return { positions, cellM };
}

/**
 * Slope in degrees from a 3×3 block of heights (Horn's method, the one GDAL
 * and every GIS use), or null when any of the nine is unknown: a slope from a
 * partial window would be a confident number about ground nobody measured.
 */
export function slopeDegrees(
  heights: readonly (number | null)[],
  cellM: number,
): number | null {
  if (heights.length !== 9 || !(cellM > 0)) return null;
  if (heights.some((h) => h == null || !Number.isFinite(h))) return null;
  const [nw, n, ne, w, , e, sw, s, se] = heights as number[];
  const eastward = (ne! + 2 * e! + se! - (nw! + 2 * w! + sw!)) / (8 * cellM);
  const southward = (sw! + 2 * s! + se! - (nw! + 2 * n! + ne!)) / (8 * cellM);
  return (Math.atan(Math.hypot(eastward, southward)) * 180) / Math.PI;
}
