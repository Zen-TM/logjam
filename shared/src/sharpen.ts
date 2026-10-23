// Sharpened areas: a LiDAR job whose output is the statewide terrain formats
// at the survey's own cell (topo/sharpen.py), instead of the styled layers of
// a legacy job. Each one is a private DEM source, and every map tile comes
// from exactly one archive: the statewide one or one area's.
// docs/decisions/0040-a-sharpened-area-is-a-private-dem-source.md
//
// PRIVACY: an area's tile range and coverage say where its owner surveyed.
// Nothing in this file logs, and no caller may log what it returns.

import {
  DEM_SOURCES,
  SHARPENED_SOURCE_PREFIX,
  type DemSource,
} from "./demSources.js";

/**
 * Whether /start marks a new job to sharpen. Off until Logjam Web draws
 * sharpened areas: merging to main deploys the API and the worker, and
 * before then a sharpened job's archives would draw on no client.
 */
export const SHARPEN_NEW_JOBS = false;

/** A completed sharpened job, as a client and the API's sampler need it. */
export type SharpenedArea = {
  /** The job's id. */
  id: string;
  /** The deepest zoom its archives hold: 16 for 2 m ground, 17 for 1 m. */
  zmax: 16 | 17;
  /**
   * The z15 tiles its height and slope archives hold, inclusive
   * [x0, y0, x1, y1]: whole z14 tiles, so x0 and y0 are even and x1 and y1
   * odd. Every one of them holds every descendant to `zmax`.
   */
  tiles15: readonly [number, number, number, number];
  /** [west, south, east, north] of the survey's ground. */
  coverage: readonly [number, number, number, number];
  /** Whether it has a contour archive: none when no 10 m level crosses it. */
  contours: boolean;
  /** The survey's credit, as the worker wrote it into each archive. */
  credit: string;
  createdAt: string;
};

/**
 * A sharpened area in `GET /topo-jobs/completed-overlays` (its `sharpened`
 * field): the area, and its archives as presigned URLs that expire with the
 * response's `expiresAt`. A sharee gets the same; the archive keys never
 * leave the API.
 */
export type SharpenedOverlay = SharpenedArea & {
  heightsUrl: string;
  slopeUrl: string;
  /** Null when the area has no contour archive (`contours` false). */
  contoursUrl: string | null;
};

/** The archives a sharpened area has, and the statewide ones it replaces. */
export const TERRAIN_ARCHIVE_LAYERS = ["heights", "slope", "contours"] as const;

export type TerrainArchiveLayer = (typeof TERRAIN_ARCHIVE_LAYERS)[number];

/**
 * Which of two areas answers where both could: the finer, then the newer,
 * then the lower id, so the order never depends on how a list was fetched.
 * The sampler and the tile router use the same order, so a height and the
 * tile drawn under it come from the same area.
 */
export function compareSharpenedAreas(
  a: SharpenedArea,
  b: SharpenedArea,
): number {
  if (a.zmax !== b.zmax) return b.zmax - a.zmax;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * An area as a DEM source. It ranks above every statewide source
 * (ADR 0028), and its archive is private: each runtime opens it itself,
 * after it has checked the caller may read the area.
 */
export function sharpenedDemSource(area: SharpenedArea): DemSource {
  return {
    id: `${SHARPENED_SOURCE_PREFIX}${area.id}`,
    sampleZoom: area.zmax,
    coverage: area.coverage,
    urlTemplate: null,
    archivePath: null,
    areaId: area.id,
    credit: area.credit,
    creditHtml: escapeHtml(area.credit),
  };
}

/** Every source a caller who can see `areas` reads, finest first. */
export function demSourcesFor(
  areas: readonly SharpenedArea[],
): readonly DemSource[] {
  return [
    ...[...areas].sort(compareSharpenedAreas).map(sharpenedDemSource),
    ...DEM_SOURCES,
  ];
}

/** Where a terrain tile comes from: the statewide archive, an area's, or none. */
export type TerrainTileAnswer = "statewide" | "absent" | SharpenedArea;

const holds = (
  range: readonly [number, number, number, number],
  x: number,
  y: number,
) => x >= range[0] && x <= range[2] && y >= range[1] && y <= range[3];

/**
 * The one archive a terrain tile is read from, so no pixel is drawn by two.
 *
 * Heights and slope: statewide below z15. From z15 the first area (in
 * `compareSharpenedAreas` order) whose range holds the tile's z15 ancestor
 * answers down to its zmax; past it, or past z15 where no area holds the
 * tile, the tile is absent and the renderer draws its parent. A z15 tile in
 * an area's range has every descendant, and one outside has none, so a
 * parent never draws beside its own children.
 *
 * Contours: statewide below z14 (the statewide archive's deepest zoom); at
 * z14 and deeper, the first area with a contour archive whose range holds
 * the z14 ancestor, else statewide. Deeper zooms overzoom z14, so a contour
 * tile is never absent. Guard: `sharpen.test.ts`.
 */
export function terrainTileArchive(
  areas: readonly SharpenedArea[],
  layer: TerrainArchiveLayer,
  z: number,
  x: number,
  y: number,
): TerrainTileAnswer {
  const ordered = [...areas].sort(compareSharpenedAreas);
  if (layer === "contours") {
    if (z < 14) return "statewide";
    const shift = z - 14;
    const area = ordered.find(
      (a) =>
        a.contours &&
        holds(
          [
            a.tiles15[0] >> 1,
            a.tiles15[1] >> 1,
            a.tiles15[2] >> 1,
            a.tiles15[3] >> 1,
          ],
          x >> shift,
          y >> shift,
        ),
    );
    return area ?? "statewide";
  }
  if (z < 15) return "statewide";
  const shift = z - 15;
  const area = ordered.find((a) => holds(a.tiles15, x >> shift, y >> shift));
  if (area) return z <= area.zmax ? area : "absent";
  return z === 15 ? "statewide" : "absent";
}
