// Deterministic raster tile plan for a GeoPDF import (Stage 6 §3.4).
//
// Pure function of (GeoTransform, clip polygon): the import pipeline replays
// the identical plan on resume, so tile order and warp payloads must be
// stable. JS speaks XYZ tile coords everywhere; the native writer flips to
// TMS rows inside the MBTiles inserts.
import type { GeoTransform, XY } from "./transform.js";

export type WarpSpec =
  | {
      /** page pt → tile px: x' = m0·x + m1·y + m2 ; y' = m3·x + m4·y + m5. */
      kind: "affine";
      m: [number, number, number, number, number, number];
    }
  | {
      /**
       * Forward mesh: uniform (grid+1)² node lattice over srcRect (page pts,
       * row-major from the srcRect's bottom-left, x fastest), each node's
       * destination in tile px. Matches Android drawBitmapMesh semantics.
       */
      kind: "mesh";
      grid: number;
      srcRect: { x0: number; y0: number; x1: number; y1: number };
      dst: number[];
    };

export interface TileJob {
  z: number;
  x: number;
  y: number;
  warp: WarpSpec;
  /** Page-space render window for this tile, padded (native renders this). */
  srcRect: { x0: number; y0: number; x1: number; y1: number };
}

export interface TilePlan {
  zMin: number;
  zMax: number;
  tileSize: 512;
  /** Base-zoom tiles only; overviews are downsampled by the native side. */
  tiles: TileJob[];
  /** For the progress UI: base tiles + pyramid ≈ ×4/3. */
  estimatedTotalTiles: number;
}

const TILE_SIZE = 512;
const MESH_GRID = 4;
/** Assumed source detail: 300 dpi print intent = 300/72 px per page pt. */
const SRC_PX_PER_PT = 300 / 72;
const EARTH_RADIUS = 6378137;
const ORIGIN_SHIFT = 20037508.342789244;
const Z_MAX_CLAMP = { min: 10, max: 18 } as const;
const Z_MIN_FLOOR = 7;

/** Web Mercator ground resolution (m/px) at latitude φ for a 512px-tile zoom. */
function webMercatorRes(z: number, latDeg: number): number {
  return (
    ((156543.03392804097 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** z) /
    (TILE_SIZE / 256)
  );
}

function lonLatToMercator(lon: number, lat: number): XY {
  return {
    x: (lon / 180) * ORIGIN_SHIFT,
    y: Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * EARTH_RADIUS,
  };
}

/** XYZ tile → mercator bounds. */
function tileMercatorBounds(z: number, x: number, y: number) {
  const worldSize = 2 * ORIGIN_SHIFT;
  const tileSpan = worldSize / 2 ** z;
  return {
    x0: -ORIGIN_SHIFT + x * tileSpan,
    x1: -ORIGIN_SHIFT + (x + 1) * tileSpan,
    // XYZ y counts from the top (north) edge
    y1: ORIGIN_SHIFT - y * tileSpan,
    y0: ORIGIN_SHIFT - (y + 1) * tileSpan,
  };
}

function pointInPolygon(p: XY, polygon: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const cross = (o: XY, p: XY, q: XY) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0));
}

/** Coarse tile-rect vs clip-polygon intersection in mercator space (§3.4.3). */
function tileIntersectsClip(
  bounds: { x0: number; y0: number; x1: number; y1: number },
  clipMerc: XY[],
): boolean {
  const corners: XY[] = [
    { x: bounds.x0, y: bounds.y0 },
    { x: bounds.x1, y: bounds.y0 },
    { x: bounds.x1, y: bounds.y1 },
    { x: bounds.x0, y: bounds.y1 },
  ];
  if (corners.some((c) => pointInPolygon(c, clipMerc))) return true;
  if (clipMerc.some((p) => p.x >= bounds.x0 && p.x <= bounds.x1 && p.y >= bounds.y0 && p.y <= bounds.y1)) {
    return true;
  }
  for (let i = 0; i < clipMerc.length; i++) {
    const p1 = clipMerc[i];
    const p2 = clipMerc[(i + 1) % clipMerc.length];
    for (let j = 0; j < 4; j++) {
      if (segmentsIntersect(p1, p2, corners[j], corners[(j + 1) % 4])) return true;
    }
  }
  return false;
}

export function buildTilePlan(
  transform: GeoTransform,
  clipPolygonPt: XY[],
): TilePlan {
  const { wgs84Bounds } = transform;
  const latCentre = (wgs84Bounds.north + wgs84Bounds.south) / 2;

  // Ground resolution of the source. Estimate metres-per-page-pt from the
  // local Jacobian of pageToMercator at the clip centroid (exact for the
  // affine fast path, locally exact otherwise), corrected from mercator
  // metres to ground metres by cos(φ).
  const centroid: XY = {
    x: clipPolygonPt.reduce((s, p) => s + p.x, 0) / clipPolygonPt.length,
    y: clipPolygonPt.reduce((s, p) => s + p.y, 0) / clipPolygonPt.length,
  };
  const h = 1; // pt
  const m0 = transform.pageToMercator(centroid);
  const mx = transform.pageToMercator({ x: centroid.x + h, y: centroid.y });
  const my = transform.pageToMercator({ x: centroid.x, y: centroid.y + h });
  const jacobianDet = Math.abs(
    (mx.x - m0.x) * (my.y - m0.y) - (my.x - m0.x) * (mx.y - m0.y),
  );
  const mercatorPerPt = Math.sqrt(jacobianDet);
  const groundResPerPt = mercatorPerPt * Math.cos((latCentre * Math.PI) / 180);
  const groundRes = groundResPerPt / SRC_PX_PER_PT;

  let zMax = Z_MAX_CLAMP.min;
  while (zMax < Z_MAX_CLAMP.max && webMercatorRes(zMax, latCentre) > 1.25 * groundRes) {
    zMax++;
  }

  // Clip polygon in mercator, once.
  const clipMerc = clipPolygonPt.map((p) => transform.pageToMercator(p));

  // zMin: coarsest level with the whole map inside ≤ 2×2 tiles.
  const mercXs = clipMerc.map((p) => p.x);
  const mercYs = clipMerc.map((p) => p.y);
  const spanX = Math.max(...mercXs) - Math.min(...mercXs);
  const spanY = Math.max(...mercYs) - Math.min(...mercYs);
  // zMin = the coarsest level built: downsample from zMax until the whole
  // map fits in ≤ 2×2 tiles (i.e. its span ≤ 2 tile spans), floor Z_MIN_FLOOR.
  const worldSize = 2 * ORIGIN_SHIFT;
  let zMin = zMax;
  while (zMin > Z_MIN_FLOOR && Math.max(spanX, spanY) > 2 * (worldSize / 2 ** zMin)) {
    zMin--;
  }

  // Tile list at zMax over the wgs84 bounds, clip-filtered.
  const nw = lonLatToMercator(wgs84Bounds.west, wgs84Bounds.north);
  const se = lonLatToMercator(wgs84Bounds.east, wgs84Bounds.south);
  const tileSpan = worldSize / 2 ** zMax;
  const txMin = Math.max(0, Math.floor((nw.x + ORIGIN_SHIFT) / tileSpan));
  const txMax = Math.min(2 ** zMax - 1, Math.floor((se.x + ORIGIN_SHIFT) / tileSpan));
  const tyMin = Math.max(0, Math.floor((ORIGIN_SHIFT - nw.y) / tileSpan));
  const tyMax = Math.min(2 ** zMax - 1, Math.floor((ORIGIN_SHIFT - se.y) / tileSpan));

  // Source pad: 2 source px in page units.
  const pad = 2 / SRC_PX_PER_PT;
  const affineFastPath =
    transform.planeIsWebMercator && transform.kind === "affine";

  const tiles: TileJob[] = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const bounds = tileMercatorBounds(zMax, tx, ty);
      if (!tileIntersectsClip(bounds, clipMerc)) continue;

      // merc → tile px (origin top-left of the tile, y down)
      const mercToTilePx = (m: XY): XY => ({
        x: ((m.x - bounds.x0) / tileSpan) * TILE_SIZE,
        y: ((bounds.y1 - m.y) / tileSpan) * TILE_SIZE,
      });

      // Page-space window: inverse-map corners + edge midpoints, bbox + pad.
      const sample: XY[] = [];
      for (const u of [0, 0.5, 1]) {
        for (const v of [0, 0.5, 1]) {
          if (u === 0.5 && v === 0.5) continue;
          sample.push(
            transform.mercatorToPage({
              x: bounds.x0 + u * tileSpan,
              y: bounds.y0 + v * tileSpan,
            }),
          );
        }
      }
      const srcRect = {
        x0: Math.min(...sample.map((p) => p.x)) - pad,
        y0: Math.min(...sample.map((p) => p.y)) - pad,
        x1: Math.max(...sample.map((p) => p.x)) + pad,
        y1: Math.max(...sample.map((p) => p.y)) + pad,
      };

      let warp: WarpSpec;
      if (affineFastPath) {
        // pageToMercator is affine and merc→tilePx is affine ⇒ compose
        // exactly from three probe points.
        const o = mercToTilePx(transform.pageToMercator({ x: 0, y: 0 }));
        const ex = mercToTilePx(transform.pageToMercator({ x: 1, y: 0 }));
        const ey = mercToTilePx(transform.pageToMercator({ x: 0, y: 1 }));
        warp = {
          kind: "affine",
          m: [ex.x - o.x, ey.x - o.x, o.x, ex.y - o.y, ey.y - o.y, o.y],
        };
      } else {
        const dst: number[] = [];
        for (let gy = 0; gy <= MESH_GRID; gy++) {
          for (let gx = 0; gx <= MESH_GRID; gx++) {
            const p: XY = {
              x: srcRect.x0 + (gx / MESH_GRID) * (srcRect.x1 - srcRect.x0),
              y: srcRect.y0 + (gy / MESH_GRID) * (srcRect.y1 - srcRect.y0),
            };
            const t = mercToTilePx(transform.pageToMercator(p));
            dst.push(t.x, t.y);
          }
        }
        warp = { kind: "mesh", grid: MESH_GRID, srcRect, dst };
      }

      tiles.push({ z: zMax, x: tx, y: ty, warp, srcRect });
    }
  }

  return {
    zMin,
    zMax,
    tileSize: TILE_SIZE,
    tiles,
    estimatedTotalTiles: Math.ceil((tiles.length * 4) / 3),
  };
}
