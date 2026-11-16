// Sharpened areas: a LiDAR job whose output is the statewide terrain formats
// at the survey's own cell (topo/sharpen.py). Each one is a private DEM source, and every map tile comes
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
import { MAP_TERRAIN } from "./contracts/mapTerrain.js";
import { escapeXml } from "./escapeXml.js";
import type { LicenceId } from "./licences.js";
import { lat2tileY, lon2tileX } from "./geoPdfTileMath.js";
import { t } from "./i18n.js";
import {
  REGIONS,
  WORLD,
  regionOfArea,
  type LonLatBox,
  type Region,
  type RegionSharpen,
} from "./regions.js";

/**
 * What a new LiDAR job is called wherever one is offered or made: declared
 * once (sharpen.test.ts).
 */
export const LIDAR_JOB_COPY = {
  make: "Sharpen an area",
  makeHere: "Sharpen an area here",
  noun: "Sharpened area",
  starting: "Starting to sharpen",
  startingLine: "Uploaded. Checking it over and starting to sharpen…",
  unnamed: "Your area",
  beingMade: "is being sharpened",
} as const;

type SharpenUpload = Extract<RegionSharpen, { mode: "upload" }>;
/** Where a region's users get a survey, and the steps the dialog walks them through. */
export type SharpenPortal = SharpenUpload["portal"];
type SharpenOffReason = Extract<RegionSharpen, { mode: "off" }>["reason"];

/**
 * Why sharpening is off where a region says so, as a sentence. Held beside
 * the worker's own refusals (topo/sharpen.py `NOT_SHARPENED`), which say it
 * after an upload; these say it before one.
 */
export const SHARPEN_OFF_REASON: Record<SharpenOffReason, string> = {
  "no-lidar": t`There is no LiDAR survey to sharpen from here.`,
  "already-fine": t`Logjam's terrain here is already at 1 m, so there is nothing to sharpen.`,
};

/** What Logjam Web offers for sharpening over some ground. */
export type SharpenOffer =
  | {
      mode: "upload";
      portal: SharpenPortal;
      /** Whether the vegetation layer can be asked for here. */
      vegetation: boolean;
    }
  | { mode: "off"; reason: string };

/**
 * What sharpening offers where `region` is. Over ground no region declares
 * (`null`) it is the world's entry, which has no LiDAR to sharpen from: the
 * worker refuses a survey of that ground up front (topo/sharpen.py
 * `upload_region`). Guard: `sharpen.test.ts` ("sharpenOffer").
 */
export function sharpenOffer(region: Region | null): SharpenOffer {
  const entry: RegionSharpen = (region ?? WORLD).sharpen;
  return entry.mode === "upload"
    ? {
        mode: "upload",
        portal: entry.portal,
        vegetation: entry.vegetation,
      }
    : { mode: "off", reason: SHARPEN_OFF_REASON[entry.reason] };
}

/**
 * The offer for the dialog a link to an existing job opens: the job exists, so
 * sharpening was offered where it ran, whatever ground the map shows. Judged
 * by the job's footprint when its ground takes an upload; otherwise (a failed
 * job has no footprint, and a footprint's centre can lie in a region with no
 * sharpening or in none) by the first upload region. Off only where no region
 * takes an upload. Guard: `sharpen.test.ts` ("sharpenOfferForJob").
 */
export function sharpenOfferForJob(
  footprint: LonLatBox | null,
  regions: readonly Region[] = REGIONS,
): SharpenOffer {
  const offer = footprint ? sharpenOfferFor(footprint, null, regions) : null;
  if (offer?.mode === "upload") return offer;
  return sharpenOffer(regions.find((r) => r.sharpen.mode === "upload") ?? null);
}

/** What an entry point to sharpening says where it is off: `state` beside it, `reason` for a tooltip or a screen reader. */
export type SharpenUnavailable = { state: string; reason: string };

/**
 * What an entry point to sharpening says where it is off: the Terrain layers'
 * "Not available here" beside it, and the region's reason for a tooltip or a
 * screen reader. Null where sharpening is on. Guard: `sharpen.test.ts`
 * ("sharpenUnavailable").
 */
export function sharpenUnavailable(
  offer: SharpenOffer,
): SharpenUnavailable | null {
  return offer.mode === "off"
    ? { state: MAP_TERRAIN.copy.notHere, reason: offer.reason }
    : null;
}

/**
 * The offer for an action about `box`, else about what the map shows. A box
 * is judged by the region holding its centre, which is how the worker picks
 * the one that fills the area (`regionOfArea`): a box in no region is off,
 * and never falls back to `view`. Only a `null` box reads the map's region.
 * Guard: `sharpen.test.ts` ("sharpenOfferFor").
 */
export function sharpenOfferFor(
  box: LonLatBox | null,
  view: Region | null,
  regions: readonly Region[] = REGIONS,
): SharpenOffer {
  if (!box) return sharpenOffer(view);
  return sharpenOffer(
    regionOfArea([box.west, box.south, box.east, box.north], regions),
  );
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
 * What routing reads of an archive. Logjam GPS also routes statewide clips,
 * whose z15 `zmax` ranks them under every sharpened area. Guard:
 * `sharpen.test.ts` ("puts a statewide clip").
 */
export type RoutedTerrain = Omit<SharpenedArea, "zmax"> & { zmax: number };

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
  a: RoutedTerrain,
  b: RoutedTerrain,
): number {
  if (a.zmax !== b.zmax) return b.zmax - a.zmax;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * What a sharpened area's heights are licensed under: the LiDAR is ELVIS's,
 * and NSW's sharpen credit (`sharpen.credit` in `regions.ts`) names this licence.
 * Guard: `licences.test.ts` ("names the sharpened heights' licence in the region's sharpen credit").
 */
export const SHARPENED_LICENCE = "cc-by-3-au" as const satisfies LicenceId;

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
    licence: SHARPENED_LICENCE,
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
export type TerrainTileAnswer<A extends RoutedTerrain = SharpenedArea> =
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
 * `statewideMax` is the deepest zoom of the region's own archive (the
 * entry's `maxzoom`: z15 for New South Wales's).
 *
 * Heights and slope: statewide below z15. From z15 the first area (in
 * `compareSharpenedAreas` order) whose range holds the tile's z15 ancestor
 * answers down to its zmax; past it, the tile is absent and the renderer
 * draws its parent. Where no area holds the tile, the region's archive
 * answers down to `statewideMax` and the tile is absent past it. A z15 tile
 * in an area's range has every descendant, and one outside has none, so a
 * parent never draws beside its own children.
 *
 * Contours: statewide below z14 (the statewide archive's deepest zoom); at
 * z14 and deeper, the first area with a contour archive whose range holds
 * the z14 ancestor, else statewide. Deeper zooms overzoom z14, so a contour
 * tile is never absent. The zooms are `TERRAIN_ROUTED_FROM`. Guard:
 * `sharpen.test.ts`.
 */
export function terrainTileArchive<A extends RoutedTerrain>(
  areas: readonly A[],
  layer: TerrainArchiveLayer,
  z: number,
  x: number,
  y: number,
  statewideMax: number,
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
  return z <= Math.max(from, statewideMax) ? "statewide" : "absent";
}

/**
 * The areas whose tile range meets a box, in the order the router asks them
 * (`compareSharpenedAreas`): the ones an export of the box reads. A range is
 * whole z14 tiles, so an area just outside the box can still meet it.
 */
export function areasInBox<A extends SharpenedArea>(
  areas: readonly A[],
  box: { west: number; south: number; east: number; north: number },
): A[] {
  const x0 = lon2tileX(box.west, 15);
  const x1 = lon2tileX(box.east, 15);
  const y0 = lat2tileY(box.north, 15);
  const y1 = lat2tileY(box.south, 15);
  return areas
    .filter(
      ({ tiles15: [ax0, ay0, ax1, ay1] }) =>
        ax0 <= x1 && ax1 >= x0 && ay0 <= y1 && ay1 >= y0,
    )
    .sort(compareSharpenedAreas);
}
