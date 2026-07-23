// Offline-region tile math (stage4a-basemaps.md §3) — single source for the
// estimator UI, the download caps, the tile-pyramid downloader, and resume:
// all derive from the same deterministic plan so they can never disagree.

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

/** Hard cap: download disabled above this many tiles. */
export const MAX_REGION_TILES = 4000;
/** Non-blocking "large region" warning threshold. */
export const SOFT_WARN_TILES = 1500;
/** Sanity bound on a degenerate bbox, independent of the tile cap. */
export const MAX_REGION_EDGE_KM = 50;

const EARTH_RADIUS_KM = 6371;

/** Great-circle-ish edge lengths of the bbox (km): [widthAtCenterLat, height]. */
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
  | { ok: false; reason: "too-many-tiles" | "edge-too-long" };

export function checkRegionCaps(
  bbox: RegionBbox,
  plan: RegionTilePlan,
): RegionCapCheck {
  const [w, h] = regionEdgesKm(bbox);
  if (w > MAX_REGION_EDGE_KM || h > MAX_REGION_EDGE_KM) {
    return { ok: false, reason: "edge-too-long" };
  }
  if (plan.totalTiles > MAX_REGION_TILES) {
    return { ok: false, reason: "too-many-tiles" };
  }
  return { ok: true, softWarn: plan.totalTiles > SOFT_WARN_TILES };
}

// ── Size estimation ──────────────────────────────────────────────────────────

/** Sources eligible for client-direct tile-pyramid download (SIXMaps). */
export type OfflineBasemapId = "six-topo" | "six-base" | "six-imagery";

// Per-source byte-size constants. TO CALIBRATE before the SIXMaps download UI
// ships (stage4a §3.2 / DV6): a one-off dev script fetches ~50 tiles across
// z12–z16 over a bush bbox per source and replaces these with measured
// mean/p90 + a provenance comment. Values below are the plan's implied range
// midpoints and are NOT to be surfaced to users as-is.
const TILE_BYTES_UNCALIBRATED: Record<
  OfflineBasemapId,
  { meanBytes: number; p90Bytes: number }
> = {
  "six-topo": { meanBytes: 35_000, p90Bytes: 70_000 },
  "six-base": { meanBytes: 30_000, p90Bytes: 60_000 },
  "six-imagery": { meanBytes: 45_000, p90Bytes: 90_000 },
};

export interface RegionSizeEstimate {
  meanBytes: number;
  p90Bytes: number;
  /** False until the per-source constants are measured — UI must not show raw numbers while false. */
  calibrated: boolean;
}

export function estimateRegionSize(
  plan: RegionTilePlan,
  basemapId: OfflineBasemapId,
): RegionSizeEstimate {
  const perTile = TILE_BYTES_UNCALIBRATED[basemapId];
  if (!perTile) throw new Error(`Unknown offline basemap id: ${basemapId}`);
  return {
    meanBytes: plan.totalTiles * perTile.meanBytes,
    p90Bytes: plan.totalTiles * perTile.p90Bytes,
    calibrated: false,
  };
}
