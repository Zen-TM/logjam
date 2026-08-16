// Offline-region tile math (stage4a-basemaps.md §3) — single source for the
// estimator UI, the download caps, the tile-pyramid downloader, and resume:
// all derive from the same deterministic plan so they can never disagree.

import { DEM_TILE_ZOOM } from "./demTiles.js";

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
 * XYZ→TMS row flip for MBTiles writes. The single shared flip helper
 * (deviation DV5): Stage 4a writes through it in JS; Stage 6's native module
 * documents the same convention.
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

// ── Caps (client-enforced; stage4a §3.3) ─────────────────────────────────────

/**
 * Hard cap on the tiles ONE download job may fetch — download disabled above
 * it. ~22 min at the politeness pace (§5.4), which is the real reason for the
 * number: it bounds how long the user is asked to hold the app open.
 *
 * Applied to the TOTAL across every selected source, because that total is what
 * they wait for. Picking topo + imagery for the same area doubles the tiles and
 * doubles the wait, so it has to count against the same budget.
 */
export const MAX_REGION_TILES = 4000;
/** Non-blocking "large region" warning threshold. */
export const SOFT_WARN_TILES = 1500;
/** Sanity bound on a degenerate bbox, independent of the tile cap. */
export const MAX_REGION_EDGE_KM = 50;

const EARTH_RADIUS_KM = 6371;

/** Great-circle-ish edge lengths of the bbox (km): [widthAtCenterLat, height]. */
/** Area cap for the server-side vector clip. The API enforces the same
 * number (api/src/lib/regionClip.ts imports it) — one source, so the client
 * can never offer a region the server will refuse. */
export const MAX_REGION_AREA_KM2 = 1600; // 40×40 km

export function regionEdgesKm(bbox: RegionBbox): [number, number] {
  const centerLatRad = (((bbox.south + bbox.north) / 2) * Math.PI) / 180;
  const width =
    ((bbox.east - bbox.west) * Math.PI * EARTH_RADIUS_KM * Math.cos(centerLatRad)) /
    180;
  const height = ((bbox.north - bbox.south) * Math.PI * EARTH_RADIUS_KM) / 180;
  return [width, height];
}

export type RegionCapCheck =
  | { ok: true; softWarn: boolean }
  | { ok: false; reason: "too-many-tiles" | "edge-too-long" | "area-too-large" };

/** `totalTiles` is the sum across every selected source — see MAX_REGION_TILES. */
export function checkRegionCaps(
  bbox: RegionBbox,
  totalTiles: number,
  /** True when the selection includes the server-side vector clip, which has
   * its own AREA cap on top of the per-edge one. */
  includesVectorClip = false,
): RegionCapCheck {
  const [w, h] = regionEdgesKm(bbox);
  if (w > MAX_REGION_EDGE_KM || h > MAX_REGION_EDGE_KM) {
    return { ok: false, reason: "edge-too-long" };
  }
  // The two caps disagreed: a 50 × 40 km box passes both edge tests at
  // 2000 km² and is then refused by the clip endpoint. With only the vector
  // map selected there are no tiles to trip the tile cap, so the client
  // happily enqueued a job that could never succeed — and the failure
  // surfaced as "That didn't finish. Try again."
  if (includesVectorClip && w * h > MAX_REGION_AREA_KM2) {
    return { ok: false, reason: "area-too-large" };
  }
  if (totalTiles > MAX_REGION_TILES) {
    return { ok: false, reason: "too-many-tiles" };
  }
  return { ok: true, softWarn: totalTiles > SOFT_WARN_TILES };
}

// ── Size estimation ──────────────────────────────────────────────────────────

/** Sources eligible for client-direct tile-pyramid download (SIXMaps). */
export type OfflineBasemapId = "six-topo" | "six-base" | "six-imagery";

/**
 * The DEM saved alongside every region, so elevation profiles, point heights
 * and route gain/loss survive going offline. NOT a basemap: nothing draws it,
 * it never appears in the layer picker, and it is deliberately outside
 * `OfflineBasemapId` so it cannot leak into one.
 */
export const DEM_SOURCE_ID = "terrarium";

/** Anything the tile-pyramid downloader can fetch — basemaps plus the DEM. */
export type DownloadableTileSourceId = OfflineBasemapId | typeof DEM_SOURCE_ID;

/**
 * The pyramid always starts here: z8–z9 context costs ~10 tiles in total and is
 * what stops a zoomed-out offline map being a blank screen (deviation DV2 — the
 * user picks only the detail end).
 */
export const REGION_MIN_ZOOM = 8;

/**
 * MEASURED bytes per tile, per source, per zoom.
 *
 * Provenance: `shared/scripts/calibrate-basemap-tile-sizes.mjs`, run 2026-07-30
 * against the live SIXMaps caches — 14 random tiles per zoom, half from Blue
 * Mountains bush (dense contours, no streets) and half from the Katoomba–
 * Blackheath strip. Re-run that script and update these together.
 *
 * Per-ZOOM rather than one constant per source, because `six-base` varies 10×
 * across the range (60 KB at z12 down to 6 KB at z18 — a road-and-label map has
 * less to draw per tile the further in you go, where imagery has the same amount
 * of photo everywhere). A flat mean would over-estimate a deep download by an
 * order of magnitude and under-estimate a shallow one.
 *
 * BOTH terrain types, because the first pass sampled only bush and the estimate
 * came out 40 % under for a real download centred on Katoomba: a topo tile over a
 * town carries streets, labels and building fill and measures ~1.5× a bush tile
 * at the same zoom. People save the area around a trailhead, and a trailhead is
 * usually near a town, so bush-only sampling is a systematically optimistic lie.
 *
 * Also measured: `six-imagery` returns 404 for some z18 tiles, which is the
 * "advertised LOD ≠ cached tile" case the plan flagged. Those are gaps, not
 * errors — the downloader records them and the UI counts them separately.
 */
const TILE_BYTES: Record<
  DownloadableTileSourceId,
  Record<number, { meanBytes: number; p90Bytes: number }>
> = {
  "six-topo": {
    12: { meanBytes: 12_441, p90Bytes: 13_085 },
    13: { meanBytes: 16_414, p90Bytes: 23_139 },
    14: { meanBytes: 14_754, p90Bytes: 17_674 },
    15: { meanBytes: 18_013, p90Bytes: 24_397 },
    16: { meanBytes: 18_199, p90Bytes: 28_638 },
  },
  "six-base": {
    12: { meanBytes: 59_847, p90Bytes: 65_983 },
    13: { meanBytes: 43_479, p90Bytes: 53_631 },
    14: { meanBytes: 41_651, p90Bytes: 51_895 },
    15: { meanBytes: 26_577, p90Bytes: 41_196 },
    16: { meanBytes: 18_518, p90Bytes: 25_044 },
    17: { meanBytes: 9_113, p90Bytes: 15_942 },
    18: { meanBytes: 5_720, p90Bytes: 8_066 },
  },
  // ONE zoom, because DEM_TILE_ZOOM is the only level anything reads
  // (shared/src/demTiles.ts). Measured 2026-08-16, same script, 14 tiles over
  // the same two bboxes: terrarium PNGs are noise-like height fields, so town
  // and bush cost the same and the spread is narrow.
  terrarium: {
    13: { meanBytes: 34_495, p90Bytes: 38_109 },
  },
  "six-imagery": {
    12: { meanBytes: 15_885, p90Bytes: 21_250 },
    13: { meanBytes: 15_663, p90Bytes: 19_351 },
    14: { meanBytes: 13_828, p90Bytes: 17_858 },
    15: { meanBytes: 14_433, p90Bytes: 18_393 },
    16: { meanBytes: 16_907, p90Bytes: 18_596 },
    17: { meanBytes: 20_080, p90Bytes: 23_563 },
    18: { meanBytes: 17_347, p90Bytes: 20_444 },
  },
};

/**
 * What the MBTiles container costs on top of the tile bytes (pages, the unique
 * index, metadata).
 *
 * MEASURED on a finished 34-tile region: 783,876 bytes of tile data in an
 * 839,680-byte file — 7.1 %. Without it the figure understates the disk the user
 * actually loses, which is the one direction a storage estimate must not err in.
 */
const CONTAINER_OVERHEAD = 1.071;

/** Nearest measured zoom's figures — z8–z11 ride the shallowest measurement. */
function tileBytesAt(
  sourceId: DownloadableTileSourceId,
  z: number,
): { meanBytes: number; p90Bytes: number } {
  const table = TILE_BYTES[sourceId];
  if (!table) throw new Error(`Unknown offline tile source id: ${sourceId}`);
  const measured = Object.keys(table).map(Number);
  const nearest = measured.reduce((best, candidate) =>
    Math.abs(candidate - z) < Math.abs(best - z) ? candidate : best,
  );
  return table[nearest];
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
  let meanBytes = 0;
  let p90Bytes = 0;
  for (const level of plan.perZoom) {
    const perTile = tileBytesAt(sourceId, level.z);
    meanBytes += level.count * perTile.meanBytes;
    p90Bytes += level.count * perTile.p90Bytes;
  }
  return {
    meanBytes: Math.round(meanBytes * CONTAINER_OVERHEAD),
    p90Bytes: Math.round(p90Bytes * CONTAINER_OVERHEAD),
  };
}

/**
 * Sustained tiles/second of the politeness envelope (stage4a §5.4: token bucket
 * refilling 3/s). The honest number for "how long will this take" — the burst
 * capacity only helps the first two seconds.
 */
export const REGION_TILES_PER_SECOND = 3;

export function estimateRegionSeconds(totalTiles: number): number {
  return Math.ceil(totalTiles / REGION_TILES_PER_SECOND);
}

export interface MultiSourceRegionPlan {
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
 * estimate, the tile cap and the free-space check honest.
 */
export function planRegionForBasemaps(
  bbox: RegionBbox,
  basemapIds: OfflineBasemapId[],
  zMax: number,
  maxZoomFor: (basemapId: OfflineBasemapId) => number,
): MultiSourceRegionPlan {
  const demPlan = planRegionTiles(bbox, DEM_TILE_ZOOM, DEM_TILE_ZOOM);
  const perSource = [
    ...basemapIds.map((basemapId) => {
      const clamped = Math.min(zMax, maxZoomFor(basemapId));
      const plan = planRegionTiles(bbox, REGION_MIN_ZOOM, clamped);
      return {
        basemapId: basemapId as DownloadableTileSourceId,
        zMin: REGION_MIN_ZOOM,
        zMax: clamped,
        plan,
        size: estimateRegionSize(plan, basemapId),
      };
    }),
    {
      basemapId: DEM_SOURCE_ID as DownloadableTileSourceId,
      zMin: DEM_TILE_ZOOM,
      zMax: DEM_TILE_ZOOM,
      plan: demPlan,
      size: estimateRegionSize(demPlan, DEM_SOURCE_ID),
    },
  ];
  const totalTiles = perSource.reduce((sum, s) => sum + s.plan.totalTiles, 0);
  return {
    perSource,
    totalTiles,
    meanBytes: perSource.reduce((sum, s) => sum + s.size.meanBytes, 0),
    p90Bytes: perSource.reduce((sum, s) => sum + s.size.p90Bytes, 0),
    seconds: estimateRegionSeconds(totalTiles),
  };
}
