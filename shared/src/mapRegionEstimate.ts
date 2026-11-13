// Offline-region tile math — single source for the
// estimator UI, the download caps, the tile-pyramid downloader, and resume:
// all derive from the same deterministic plan so they can never disagree.

import { DEM_SOURCES, TERRARIUM, type DemSource } from "./demSources.js";
import { BASEMAP_CATALOG } from "./geoPdfBaseLayers.js";
import { landClip } from "./nswLand.js";
import {
  REGIONS,
  regionsTouching,
  type HeightsArchive,
  type Region,
  type TerrainArchive,
  type TileBytes,
} from "./regions.js";

export type RegionBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Standard slippy-map tile coordinates for a lon/lat at zoom z. */
export function lonLatToTile(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  const clamp = (v: number) => Math.min(Math.max(v, 0), n - 1);
  return { x: clamp(x), y: clamp(y) };
}

/**
 * XYZ→TMS row flip for MBTiles writes: JS and native tile writers share the
 * same convention.
 */
export function xyzToTmsRow(z: number, y: number): number {
  return (1 << z) - 1 - y;
}

export interface RegionTilePlan {
  perZoom: {
    z: number;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    count: number;
  }[];
  totalTiles: number;
}

/**
 * Exact per-level tile ranges for a bbox across zMin..zMax (inclusive).
 * Counts come from the bbox's corner tiles, not an areal approximation.
 */
export function planRegionTiles(
  bbox: RegionBbox,
  zMin: number,
  zMax: number,
): RegionTilePlan {
  if (
    !(bbox.west < bbox.east) ||
    !(bbox.south < bbox.north) ||
    Math.abs(bbox.south) > 85.06 ||
    Math.abs(bbox.north) > 85.06
  ) {
    throw new Error("Invalid region bbox");
  }
  if (!Number.isInteger(zMin) || !Number.isInteger(zMax) || zMin > zMax) {
    throw new Error("Invalid zoom range");
  }
  const perZoom: RegionTilePlan["perZoom"] = [];
  let totalTiles = 0;
  for (let z = zMin; z <= zMax; z++) {
    const topLeft = lonLatToTile(bbox.west, bbox.north, z);
    const bottomRight = lonLatToTile(bbox.east, bbox.south, z);
    const x0 = topLeft.x;
    const x1 = bottomRight.x;
    const y0 = topLeft.y;
    const y1 = bottomRight.y;
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    perZoom.push({ z, x0, x1, y0, y1, count });
    totalTiles += count;
  }
  return { perZoom, totalTiles };
}

// ── Caps (client-enforced) ──────────────────────────────────────────────────

/**
 * Hard cap on the tiles ONE download job may fetch — download disabled above
 * it. ~22 min at the politeness pace, which is the real reason for the
 * number: it bounds how long the user is asked to hold the app open.
 *
 * Applied to the TOTAL across every selected source, because that total is what
 * they wait for. Picking topo + imagery for the same area doubles the tiles and
 * doubles the wait, so it has to count against the same budget.
 */
export const MAX_REGION_TILES = 4000;
/** Non-blocking "large region" warning threshold. */
export const SOFT_WARN_TILES = 1500;
/** Stops a long thin strip, which the area limit alone would allow. */
export const MAX_REGION_EDGE_KM = 50;

const EARTH_RADIUS_KM = 6371;

/** Great-circle-ish edge lengths of the bbox (km): [widthAtCenterLat, height]. */
/** Area cap for every save, which bounds what the clips cut on the phone cost. */
export const MAX_REGION_AREA_KM2 = 1600; // 40×40 km

export function regionEdgesKm(bbox: RegionBbox): [number, number] {
  const centerLatRad = (((bbox.south + bbox.north) / 2) * Math.PI) / 180;
  const width =
    ((bbox.east - bbox.west) *
      Math.PI *
      EARTH_RADIUS_KM *
      Math.cos(centerLatRad)) /
    180;
  const height = ((bbox.north - bbox.south) * Math.PI * EARTH_RADIUS_KM) / 180;
  return [width, height];
}

export type RegionCapCheck =
  | { ok: true; softWarn: boolean }
  | {
      ok: false;
      reason: "too-many-tiles" | "edge-too-long" | "area-too-large";
    };

/** `totalTiles` is the sum across every selected source — see MAX_REGION_TILES. */
export function checkRegionCaps(
  bbox: RegionBbox,
  totalTiles: number,
): RegionCapCheck {
  const [w, h] = regionEdgesKm(bbox);
  if (w > MAX_REGION_EDGE_KM || h > MAX_REGION_EDGE_KM) {
    return { ok: false, reason: "edge-too-long" };
  }
  // One area for every save, whatever is in it
  // (docs/decisions/0036-the-phone-cuts-its-own-offline-clips.md): every save
  // cuts the vector map, the contours and a DEM archive, and the cap bounds
  // what that costs a phone in requests, bytes and time.
  if (w * h > MAX_REGION_AREA_KM2) {
    return { ok: false, reason: "area-too-large" };
  }
  if (totalTiles > MAX_REGION_TILES) {
    return { ok: false, reason: "too-many-tiles" };
  }
  return { ok: true, softWarn: totalTiles > SOFT_WARN_TILES };
}

// ── Size estimation ──────────────────────────────────────────────────────────

/**
 * A basemap the tile-pyramid downloader can fetch: the id of a raster entry in
 * `BASEMAP_CATALOG` that is `offlineCapable`, which `pyramidTileBytes` checks.
 */
export type OfflineBasemapId = string;

/**
 * The DEM saved alongside every region, so elevation profiles, point heights
 * and route gain/loss survive going offline. NOT a basemap: nothing draws it,
 * it never appears in the layer picker, and it is deliberately outside the
 * catalogue, so it cannot leak into a basemap's list.
 */
export const DEM_SOURCE_ID = TERRARIUM.id;

/** The only zoom the DEM is saved at: the one the sampler reads. */
const DEM_ZOOM = TERRARIUM.sampleZoom;

/**
 * MEASURED bytes of one worldwide DEM tile, by the same script as the SIX
 * basemaps' (`shared/scripts/calibrate-basemap-tile-sizes.mjs`), 14 tiles over
 * the same two bboxes. ONE zoom, because a source's `sampleZoom` is the only
 * level anything reads (shared/src/demSources.ts): terrarium PNGs are noise-like
 * height fields, so town and bush cost the same and the spread is narrow.
 */
const TERRARIUM_TILE_BYTES: TileBytes = {
  13: { meanBytes: 34_495, p90Bytes: 38_109 },
};

/**
 * The basemaps a save offers as a tile pyramid: every `offlineCapable` raster
 * entry of `BASEMAP_CATALOG`, listed so a client can type its chips by them.
 * Guard: `mapRegionEstimate.test.ts` ("lists every offline-capable raster
 * basemap, and only those").
 */
export const DOWNLOADABLE_BASEMAP_IDS = [
  "six-topo",
  "six-base",
  "six-imagery",
] as const;

/** Anything the tile-pyramid downloader can fetch: basemaps plus the DEM. */
export type DownloadableTileSourceId = string;

/**
 * The pyramid always starts here: z8–z9 context costs ~10 tiles in total and is
 * what stops a zoomed-out offline map being a blank screen (the user picks only
 * the detail end).
 */
export const REGION_MIN_ZOOM = 8;

/**
 * What the MBTiles container costs on top of the tile bytes (pages, the unique
 * index, metadata).
 *
 * MEASURED on a finished 34-tile region: 783,876 bytes of tile data in an
 * 839,680-byte file — 7.1 %. Without it the figure understates the disk the user
 * actually loses, which is the one direction a storage estimate must not err in.
 */
const CONTAINER_OVERHEAD = 1.071;

/** The tile sizes of a downloadable source, or an error: never a guess. */
function pyramidTileBytes(sourceId: DownloadableTileSourceId): TileBytes {
  if (sourceId === DEM_SOURCE_ID) return TERRARIUM_TILE_BYTES;
  const entry = BASEMAP_CATALOG.find((e) => e.id === sourceId);
  if (!entry?.offlineCapable || entry.kind !== "raster")
    throw new Error(`Unknown offline tile source id: ${sourceId}`);
  return entry.tileBytes;
}

/** Nearest measured zoom's figures — z8–z11 ride the shallowest measurement. */
function tileBytesAt(
  table: TileBytes,
  z: number,
): { meanBytes: number; p90Bytes: number } {
  const measured = Object.keys(table).map(Number);
  const nearest = measured.reduce((best, candidate) =>
    Math.abs(candidate - z) < Math.abs(best - z) ? candidate : best,
  );
  return table[nearest]!;
}

export interface RegionSizeEstimate {
  meanBytes: number;
  p90Bytes: number;
}

/**
 * Size of one source's pyramid, weighted per zoom — the plan's own per-level
 * counts times that level's measured tile size, never an average over the whole
 * pyramid (75 % of the tiles live at the deepest level, where `six-base` tiles
 * are a tenth of their z12 size).
 */
export function estimateRegionSize(
  plan: RegionTilePlan,
  sourceId: DownloadableTileSourceId,
): RegionSizeEstimate {
  const table = pyramidTileBytes(sourceId);
  let meanBytes = 0;
  let p90Bytes = 0;
  for (const level of plan.perZoom) {
    const perTile = tileBytesAt(table, level.z);
    meanBytes += level.count * perTile.meanBytes;
    p90Bytes += level.count * perTile.p90Bytes;
  }
  return {
    meanBytes: Math.round(meanBytes * CONTAINER_OVERHEAD),
    p90Bytes: Math.round(p90Bytes * CONTAINER_OVERHEAD),
  };
}

/**
 * Sustained tiles/second of the politeness envelope (token bucket
 * refilling 3/s). The honest number for "how long will this take" — the burst
 * capacity only helps the first two seconds.
 */
export const REGION_TILES_PER_SECOND = 3;

export function estimateRegionSeconds(totalTiles: number): number {
  return Math.ceil(totalTiles / REGION_TILES_PER_SECOND);
}

/**
 * The zoom a saved clip of a height archive starts at: the one its region's
 * hillshade is drawn from, which would vanish below z15 without the shallower
 * zooms. The sampler reads only the `sampleZoom`. A source no region owns
 * starts at its `sampleZoom`.
 */
export function demClipMinZoom(
  source: DemSource,
  regions: readonly Region[] = REGIONS,
): number {
  const owner = regions.find((r) => r.terrain.heights?.id === source.id);
  return owner?.terrain.hillshade?.minzoom ?? source.sampleZoom;
}

/**
 * The DEM archives an offline area saves a clip of: every one whose coverage
 * the area touches. All of them, not just the finest, because a finer source
 * has holes and edges, and a line that crosses one is measured in the source
 * underneath (`sampleDem`). The worldwide tile set is saved with every area
 * regardless, by the tile engine (`DEM_SOURCE_ID`).
 */
export function planDemDownload(
  bbox: RegionBbox,
  sources: readonly DemSource[] = DEM_SOURCES,
): DemSource[] {
  return sources.filter(({ archivePath, coverage }) => {
    if (archivePath == null) return false;
    if (!coverage) return true;
    const [west, south, east, north] = coverage;
    return (
      bbox.east >= west &&
      bbox.west <= east &&
      bbox.north >= south &&
      bbox.south <= north
    );
  });
}

/** A layer of a region's Terrain group that a save cuts a clip of. */
export type SaveClipKind =
  | "heights"
  | "slope"
  | "contours"
  | "land"
  | "fire"
  | "coverage";

/**
 * One archive an offline save cuts a clip of, and what that clip costs. Bytes
 * only, like a DEM archive's: cut by byte range from our own CDN, so a clip
 * counts toward the bytes but not toward `totalTiles` or `seconds`, which are
 * about tiles fetched one by one from a provider.
 */
export type SaveClip = {
  kind: SaveClipKind;
  archive: TerrainArchive | HeightsArchive;
  size: RegionSizeEstimate;
};

/**
 * What a clip costs: the plan's own tile count at each zoom times that zoom's
 * measured size. A clip is whole tiles, so a small area costs far more per
 * square kilometre than a large one, and only a tile count says so.
 */
function estimateClip(
  bbox: RegionBbox,
  zooms: { minzoom: number; maxzoom: number },
  tileBytes: TileBytes,
): RegionSizeEstimate {
  const { perZoom } = planRegionTiles(bbox, zooms.minzoom, zooms.maxzoom);
  const bytes = (key: keyof RegionSizeEstimate) =>
    perZoom.reduce((sum, { z, count }) => {
      const perTile = tileBytes[z];
      if (!perTile) throw new Error(`No measured tile size at z${z}`);
      return sum + count * perTile[key];
    }, 0);
  return { meanBytes: bytes("meanBytes"), p90Bytes: bytes("p90Bytes") };
}

/**
 * The clips a save of `bbox` cuts: for each region whose border touches it, the
 * archives of that region's Terrain group, in the order of `SaveClipKind`. A box
 * outside every region cuts none. A height archive is left out where the box is
 * outside its coverage (`planDemDownload`); the others are priced for any box
 * the border touches, inside their coverage or not. Guard:
 * `mapRegionEstimate.test.ts` ("what a save costs, by the archives that cover
 * its box").
 */
function saveClipsFor(
  bbox: RegionBbox,
  regions: readonly Region[],
): SaveClip[] {
  return regionsTouching(bbox, regions).flatMap(({ terrain }) => {
    const clips: SaveClip[] = [];
    const add = (
      kind: SaveClipKind,
      archive: TerrainArchive | HeightsArchive,
      zooms: { minzoom: number; maxzoom: number },
    ) =>
      clips.push({
        kind,
        archive,
        size: estimateClip(bbox, zooms, archive.tileBytes),
      });
    const { heights, slope, contours, land, fire, coverage } = terrain;
    if (heights && planDemDownload(bbox, [heights]).length > 0)
      add("heights", heights, {
        minzoom: demClipMinZoom(heights, regions),
        maxzoom: heights.sampleZoom,
      });
    if (slope) add("slope", slope, slope);
    if (contours) add("contours", contours, contours);
    if (land) add("land", land, landClip(land));
    if (fire) add("fire", fire, fire);
    if (coverage) add("coverage", coverage, coverage);
    return clips;
  });
}

export interface MultiSourceRegionPlan {
  /** The archives of every region the area touches, which the save clips. */
  clips: SaveClip[];
  perSource: {
    basemapId: DownloadableTileSourceId;
    /** Shallowest level of this source's pyramid. Flat sources set it to zMax. */
    zMin: number;
    /** zMax after clamping to what this source actually serves. */
    zMax: number;
    plan: RegionTilePlan;
    size: RegionSizeEstimate;
  }[];
  totalTiles: number;
  meanBytes: number;
  p90Bytes: number;
  seconds: number;
}

/**
 * The whole job the user is about to commit to: one pyramid per selected
 * source, each clamped to its own deepest served level, plus the totals the
 * caps and the estimator UI both read. Selecting three sources at z16 is three
 * downloads and three times the bytes — the figure has to say so.
 *
 * The DEM rides along with EVERY region, unasked. It is a single flat level and
 * a few percent of one basemap's bytes, and without it a saved area loses its
 * elevation profiles, point heights and route gain/loss the moment the phone
 * goes offline — which is the trip the download exists for. Costing it into
 * these totals (rather than adding it silently later) is what keeps the size
 * estimate, the tile cap and the free-space check honest. So are the clips of
 * the archives of each region the area touches (`saveClipsFor`), which every
 * area saves too: an area outside every region costs only its basemaps and the
 * worldwide DEM.
 */
export function planRegionForBasemaps(
  bbox: RegionBbox,
  basemapIds: OfflineBasemapId[],
  zMax: number,
  maxZoomFor: (basemapId: OfflineBasemapId) => number,
  regions: readonly Region[] = REGIONS,
): MultiSourceRegionPlan {
  const clips = saveClipsFor(bbox, regions);
  const demPlan = planRegionTiles(bbox, DEM_ZOOM, DEM_ZOOM);

  const perSource = [
    ...basemapIds.map((basemapId) => {
      const clamped = Math.min(zMax, maxZoomFor(basemapId));
      const plan = planRegionTiles(bbox, REGION_MIN_ZOOM, clamped);
      return {
        basemapId,
        zMin: REGION_MIN_ZOOM,
        zMax: clamped,
        plan,
        size: estimateRegionSize(plan, basemapId),
      };
    }),
    {
      basemapId: DEM_SOURCE_ID,
      zMin: DEM_ZOOM,
      zMax: DEM_ZOOM,
      plan: demPlan,
      size: estimateRegionSize(demPlan, DEM_SOURCE_ID),
    },
  ];
  const totalTiles = perSource.reduce((sum, s) => sum + s.plan.totalTiles, 0);
  const bytes = (key: keyof RegionSizeEstimate) =>
    [...perSource, ...clips].reduce((sum, s) => sum + s.size[key], 0);
  return {
    clips,
    perSource,
    totalTiles,
    meanBytes: bytes("meanBytes"),
    p90Bytes: bytes("p90Bytes"),
    seconds: estimateRegionSeconds(totalTiles),
  };
}
