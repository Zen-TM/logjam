// Sharpened areas: a LiDAR job whose output is the statewide terrain formats
// at the survey's own cell (topo/sharpen.py), instead of the styled layers of
// a legacy job. Each one is a private DEM source, and every map tile comes
// from exactly one archive: the statewide one or one area's.
// docs/decisions/0040-a-sharpened-area-is-a-private-dem-source.md
//
// PRIVACY: an area's tile range and coverage say where its owner surveyed.
// Nothing in this file logs.

import {
  DEM_SOURCES,
  SHARPENED_SOURCE_PREFIX,
  type DemSource,
} from "./demSources.js";
import { escapeXml } from "./escapeXml.js";

/**
 * Whether a new job sharpens: /start marks it (the worker then runs
 * topo/sharpen.py), and Logjam Web offers "Sharpen an area" with no style
 * options. It must stay true: the worker refuses a job with no mark
 * (topo/worker.py `OLD_JOB`; guard: topo/tests/test_worker_helpers.py
 * `TestProcessSharpen`), so a job started with it off fails.
 */
export const SHARPEN_NEW_JOBS = true;

/**
 * What a new LiDAR job is called wherever one is offered or made, for each
 * side of the switch: declared once (sharpen.test.ts). The switch is a
 * parameter, so each client passes the one it imports.
 */
export function lidarJobCopy(sharpen: boolean) {
  return sharpen
    ? {
        make: "Sharpen an area",
        makeHere: "Sharpen the area here",
        noun: "Sharpened area",
        starting: "Starting to sharpen",
        startingLine: "Uploaded. Checking it over and starting to sharpen…",
        unnamed: "Your area",
        beingMade: "is being sharpened",
      }
    : {
        make: "Make a LiDAR topo",
        makeHere: "Make a LiDAR topo here",
        noun: "LiDAR topo",
        starting: "Starting your topo",
        startingLine: "Uploaded. Checking it over and starting your topo…",
        unnamed: "Your topo",
        beingMade: "is being made",
      };
}

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
 * response's `expiresAt`. A sharee gets the same. The archive keys reach a
 * client only inside these URLs, never as fields of their own
 * (`api/src/__tests__/sharpenedAreas.test.ts`).
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

/** Which field of a `SharpenedOverlay` holds each archive's URL. */
export const SHARPENED_ARCHIVE_URL = {
  heights: "heightsUrl",
  slope: "slopeUrl",
  contours: "contoursUrl",
} as const satisfies Record<TerrainArchiveLayer, keyof SharpenedOverlay>;

/**
 * The zoom each archive is routed from (`terrainTileArchive`): statewide
 * below it everywhere, one archive per tile from it. Logjam GPS stops its
 * statewide layers here (`routeTerrain` in mobile/src/map/sourceResolver.ts).
 */
export const TERRAIN_ROUTED_FROM = {
  heights: 15,
  slope: 15,
  contours: 14,
} as const satisfies Record<TerrainArchiveLayer, number>;

/**
 * Which of two areas answers where both could: the finer, then the newer,
 * then the lower id, so the order never depends on how a list was fetched.
 * The sampler and the tile router use the same order. They do not ask the
 * same question of an area: the sampler its `coverage`, the router its
 * `tiles15`, the coverage widened to whole z14 tiles. In that margin the
 * first-ranked area's tile (its 5 m fill) can be drawn where a lower-ranked
 * area answers the height.
 */
export function compareSharpenedAreas(
  a: SharpenedArea,
  b: SharpenedArea,
): number {
  if (a.zmax !== b.zmax) return b.zmax - a.zmax;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * An area as a DEM source. It ranks above every statewide source
 * (ADR 0028), and its archive is private: each runtime opens it itself,
 * after it has checked the caller may read the area (the API's check:
 * `api/src/__tests__/sharpenedAreas.test.ts`).
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
    creditHtml: escapeXml(area.credit),
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
export type TerrainTileAnswer<A extends SharpenedArea = SharpenedArea> =
  | "statewide"
  | "absent"
  | A;

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
 * tile is never absent. The zooms are `TERRAIN_ROUTED_FROM`. Guard:
 * `sharpen.test.ts`.
 */
export function terrainTileArchive<A extends SharpenedArea>(
  areas: readonly A[],
  layer: TerrainArchiveLayer,
  z: number,
  x: number,
  y: number,
): TerrainTileAnswer<A> {
  const ordered = [...areas].sort(compareSharpenedAreas);
  const from = TERRAIN_ROUTED_FROM[layer];
  if (z < from) return "statewide";
  const up = 15 - from;
  const shift = z - from;
  const area = ordered.find(
    (a) =>
      (layer !== "contours" || a.contours) &&
      holds(
        [
          a.tiles15[0] >> up,
          a.tiles15[1] >> up,
          a.tiles15[2] >> up,
          a.tiles15[3] >> up,
        ],
        x >> shift,
        y >> shift,
      ),
  );
  if (layer === "contours") return area ?? "statewide";
  if (area) return z <= area.zmax ? area : "absent";
  return z === from ? "statewide" : "absent";
}
