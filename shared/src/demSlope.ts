// Slope of the ground at a point, from the DEM around it.
//
// Pure, so each client keeps its own tile reader: a caller hands it to
// `demSlopeReading` / `demSlopeAt`, which picks the finest regional source that
// covers the whole window and reads each window pixel exactly (a window that
// straddles a tile edge needs nothing special). `demSlopeWindow` and
// `slopeDegrees` are the pure parts it is built from.
//
// WHAT THE NUMBER MEANS. It is the slope of a plane fitted across three DEM
// pixels each way, so it is an average over the window and never the steepest
// thing inside it. It can only be as true as the DEM it is read from: a drop
// narrower than the window, or one the DEM never resolved, comes out gentle.
// Whoever shows it owes the user that caveat.
//
// PRIVACY: positions here are precise wilderness coordinates. Nothing logs.

import {
  demSourceCovers,
  DEM_SOURCES,
  demTileKey,
  type DemSource,
  type DemTileReader,
} from "./demSources.js";
import {
  DEM_TILE_SIZE,
  demSampleValue,
  demTileCoordinates,
  resolveDemSamples,
  type DemSampleAddress,
} from "./demTiles.js";
import type { SamplePosition } from "./elevation.js";

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export type DemSlopeWindow = {
  /** Nine pixel centres, row-major from the north-west; index 4 is the tap. */
  positions: SamplePosition[];
  /** Ground distance between neighbouring positions, the same both ways. */
  cellM: number;
};

/**
 * The 3×3 block of DEM pixels centred on the pixel a position falls in, at
 * the zoom a source is read at.
 */
export function demSlopeWindow(
  lon: number,
  lat: number,
  zoom: number,
): DemSlopeWindow {
  const pixelsAcross = 2 ** zoom * DEM_TILE_SIZE;
  const tile = demTileCoordinates(lon, lat, zoom);
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

export type DemSlopeReading = {
  slopeDegrees: number;
  /** The one source all nine heights were read from. */
  sourceId: string;
};

/**
 * The slope at a position and the source it came from, or null where it
 * cannot be told honestly.
 *
 * The finest source that has all nine heights answers, and all nine come from
 * that one surface: a source that lacks a pixel of the window (the edge of a
 * finer area, a tile not built, one no-data pixel) hands the position to the
 * next one down. Each window position's own pixel is read, never the blend of
 * four that `sampleDem` takes for a height, which can let a neighbour stand in
 * for a missing pixel (at a pixel centre the blend is its own pixel, bar float
 * noise).
 * Never the worldwide 30 m tiles (`coverage` null), which are too coarse for
 * a point slope: within 5° of a 5 m survey at 57 % of points, a median of 34°
 * on ground of 60° or steeper, where the NSW 5 m source is within 5° at 98 %.
 * So outside every regional source the answer is null and no slope is shown.
 * `demSlope.test.ts` holds this.
 *
 * At zoom 15 the window is about 12 m across: a drop or slot narrower than
 * that is averaged away.
 */
export async function demSlopeReading(
  lon: number,
  lat: number,
  readTiles: DemTileReader,
  sources: readonly DemSource[] = DEM_SOURCES,
): Promise<DemSlopeReading | null> {
  for (const source of sources) {
    if (source.coverage === null) continue;
    const { positions, cellM } = demSlopeWindow(lon, lat, source.sampleZoom);
    if (!positions.every((position) => demSourceCovers(source, position)))
      continue;
    const addresses = resolveDemSamples(positions, source.sampleZoom);
    const wanted = new Map<string, DemSampleAddress>();
    for (const address of addresses) wanted.set(demTileKey(address), address);
    const tiles = await readTiles(source, [...wanted.values()]);
    const heights = addresses.map((address) =>
      demSampleValue(tiles.get(demTileKey(address)), address.index),
    );
    const slope = slopeDegrees(heights, cellM);
    if (slope != null) return { slopeDegrees: slope, sourceId: source.id };
  }
  return null;
}

/** `demSlopeReading`'s number alone. */
export async function demSlopeAt(
  lon: number,
  lat: number,
  readTiles: DemTileReader,
  sources: readonly DemSource[] = DEM_SOURCES,
): Promise<number | null> {
  return (
    (await demSlopeReading(lon, lat, readTiles, sources))?.slopeDegrees ?? null
  );
}
