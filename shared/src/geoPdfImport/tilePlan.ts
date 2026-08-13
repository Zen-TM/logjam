// Deterministic raster tile plan for a GeoPDF import (Stage 6 §3.4).
//
// Pure function of (GeoTransform, clip polygon): the import pipeline replays
// the identical plan on resume, so tile order and warp payloads must be
// stable. JS speaks XYZ tile coords everywhere; the native writer flips to
// TMS rows inside the MBTiles inserts.
import { GeoPdfParseError } from "./parseGeoref.js";
import type { GeoTransform, XY } from "./transform.js";

/**
 * Bumped whenever anything in THIS file changes the tile list — its length, its
 * order, the warp maths, the pad, the zoom clamps.
 *
 * It lives next to the planner rather than in the pipeline because it describes
 * the planner: a checkpoint written by version N indexes into version N's tile
 * list, and honouring it against version N+1's list skips the first k entries of
 * a DIFFERENT list, which finishes as `ready` with holes in the middle of the
 * map. `resumableFrom` is the guard; this constant is what it compares.
 */
export const GEOPDF_PARSER_VERSION = 2;

/**
 * Hard ceiling on base tiles for one import, for the same reason the region
 * downloader caps at MAX_REGION_TILES: it bounds how long the user is asked to
 * hold the app open. Measured on the emulator, a 336-tile sheet costs ~99 s of
 * render + encode, so 4000 tiles is ~20 minutes — the same budget the region
 * path spends.
 *
 * Over it, `buildTilePlan` steps zMax down rather than refusing: a shallower
 * map of the user's own sheet beats no map. It only throws when even the
 * coarsest allowed zoom won't fit.
 */
export const MAX_GEOPDF_TILES = 4000;

/**
 * Seconds per base tile, and bytes per stored tile, for the pre-flight estimate.
 *
 * Seconds: measured (emulator, 336-tile 1:25 000 sheet — render 60 s, encode
 * 24 s, everything else 15 s ⇒ 0.295 s/tile), and the overview pyramid rides
 * inside `estimatedTotalTiles`'s ×4/3.
 *
 * ponytail: the BYTES figure is NOT measured — it is a deliberately generous
 * stand-in for a 512 px PNG of topo linework, and it only feeds the free-space
 * precheck, where erring high is the safe direction. Measure it the way
 * `shared/scripts/calibrate-basemap-tile-sizes.mjs` measures the basemaps and
 * replace the constant if the number ever has to be shown to the user.
 */
export const GEOPDF_SECONDS_PER_TILE = 0.3;
export const GEOPDF_BYTES_PER_TILE = 120_000;

export interface GeoPdfImportEstimate {
  /** Base tiles plus the downsampled pyramid. */
  tiles: number;
  bytes: number;
  seconds: number;
}

export function estimateGeoPdfImport(plan: TilePlan): GeoPdfImportEstimate {
  return {
    tiles: plan.estimatedTotalTiles,
    bytes: Math.round(plan.estimatedTotalTiles * GEOPDF_BYTES_PER_TILE),
    seconds: Math.ceil(plan.tiles.length * GEOPDF_SECONDS_PER_TILE),
  };
}

/**
 * The resume checkpoint the pipeline writes into the MBTiles, and the whole of
 * what a resume is allowed to trust.
 *
 * `zMax` alone was the entire validity test, and zMax is the one thing a
 * planner change is LEAST likely to move: the tile list is derived from the clip
 * polygon, the mercator extent, the mesh grid and the pad, any of which can
 * change its length and order while zMax stays put.
 */
export interface GeoPdfBuildState {
  phase: "rasterising" | "overviews";
  zMax: number;
  /** Bumped with the planner; a checkpoint from another version is unusable. */
  parserVersion?: number;
  /** `plan.tiles.length` at the time the checkpoint was written. */
  tileCount?: number;
  nextTileIndex?: number;
  /** Next zoom to downsample INTO (fromZ = downsampleZ + 1). */
  downsampleZ?: number;
}

/**
 * The checkpoint, if it describes THIS plan — otherwise null, and the import
 * replays from scratch (inserts are idempotent, so replaying is only cost).
 *
 * A checkpoint with no `parserVersion` predates the guard and is refused: an
 * unversioned resume is exactly the silently-holed map this exists to stop.
 */
export function resumableFrom(
  saved: GeoPdfBuildState | null,
  plan: TilePlan,
): GeoPdfBuildState | null {
  if (!saved) return null;
  if (saved.parserVersion !== GEOPDF_PARSER_VERSION) return null;
  if (saved.zMax !== plan.zMax) return null;
  if (saved.tileCount !== plan.tiles.length) return null;
  if (saved.phase === "rasterising") {
    const next = saved.nextTileIndex ?? 0;
    if (!Number.isInteger(next) || next < 0 || next > plan.tiles.length)
      return null;
  }
  return saved;
}

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
/** Extra overview levels below "the whole map fits in 2x2 tiles". */
const ZOOM_OUT_HEADROOM = 2;

/** Web Mercator ground resolution (m/px) at latitude φ for a 512px-tile zoom. */
function webMercatorRes(z: number, latDeg: number): number {
  return (
    (156543.03392804097 * Math.cos((latDeg * Math.PI) / 180)) /
    2 ** z /
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
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
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
  if (
    clipMerc.some(
      (p) =>
        p.x >= bounds.x0 &&
        p.x <= bounds.x1 &&
        p.y >= bounds.y0 &&
        p.y <= bounds.y1,
    )
  ) {
    return true;
  }
  for (let i = 0; i < clipMerc.length; i++) {
    const p1 = clipMerc[i];
    const p2 = clipMerc[(i + 1) % clipMerc.length];
    for (let j = 0; j < 4; j++) {
      if (segmentsIntersect(p1, p2, corners[j], corners[(j + 1) % 4]))
        return true;
    }
  }
  return false;
}

/** The zMax tiles the clip actually touches, in plan order (row-major, y outer). */
function tilesIntersecting(z: number, clipMerc: XY[]): [number, number][] {
  const worldSize = 2 * ORIGIN_SHIFT;
  const tileSpan = worldSize / 2 ** z;
  const xs = clipMerc.map((p) => p.x);
  const ys = clipMerc.map((p) => p.y);
  const txMin = Math.max(
    0,
    Math.floor((Math.min(...xs) + ORIGIN_SHIFT) / tileSpan),
  );
  const txMax = Math.min(
    2 ** z - 1,
    Math.floor((Math.max(...xs) + ORIGIN_SHIFT) / tileSpan),
  );
  const tyMin = Math.max(
    0,
    Math.floor((ORIGIN_SHIFT - Math.max(...ys)) / tileSpan),
  );
  const tyMax = Math.min(
    2 ** z - 1,
    Math.floor((ORIGIN_SHIFT - Math.min(...ys)) / tileSpan),
  );
  const hits: [number, number][] = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      if (tileIntersectsClip(tileMercatorBounds(z, tx, ty), clipMerc))
        hits.push([tx, ty]);
    }
  }
  return hits;
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
  while (
    zMax < Z_MAX_CLAMP.max &&
    webMercatorRes(zMax, latCentre) > 1.25 * groundRes
  ) {
    zMax++;
  }

  // Clip polygon in mercator, once.
  const clipMerc = clipPolygonPt.map((p) => transform.pageToMercator(p));

  // Fit the plan to the tile budget BEFORE anything is rendered. A large-format
  // or large-scale sheet plans into the thousands of tiles, which is tens of
  // minutes of rendering and hundreds of megabytes, and nothing downstream had a
  // ceiling. One level down is a quarter of the tiles, so this converges fast.
  let baseTiles = tilesIntersecting(zMax, clipMerc);
  while (zMax > Z_MAX_CLAMP.min && baseTiles.length > MAX_GEOPDF_TILES) {
    zMax--;
    baseTiles = tilesIntersecting(zMax, clipMerc);
  }
  if (baseTiles.length > MAX_GEOPDF_TILES) {
    // Unreachable for a real map sheet (the whole world is 4×4 tiles at z10),
    // so reaching it means the georeferencing is wrong, not the map big.
    throw new GeoPdfParseError("TOO_MANY_TILES");
  }

  // zMin: coarsest level with the whole map inside ≤ 2×2 tiles, then two
  // levels coarser again (see ZOOM_OUT_HEADROOM).
  const mercXs = clipMerc.map((p) => p.x);
  const mercYs = clipMerc.map((p) => p.y);
  const spanX = Math.max(...mercXs) - Math.min(...mercXs);
  const spanY = Math.max(...mercYs) - Math.min(...mercYs);
  // zMin = the coarsest level built: downsample from zMax until the whole
  // map fits in ≤ 2×2 tiles (i.e. its span ≤ 2 tile spans), floor Z_MIN_FLOOR.
  const worldSize = 2 * ORIGIN_SHIFT;
  let zMin: number = zMax;
  while (
    zMin > Z_MIN_FLOOR &&
    Math.max(spanX, spanY) > 2 * (worldSize / 2 ** zMin)
  ) {
    zMin--;
  }
  // A raster source draws NOTHING below its minzoom — no downscaling from the
  // level above — so an imported map vanished the moment the user pulled back
  // far enough to want context around it. The extra levels cost ~1/4 and ~1/16
  // of one level's tiles (single digits of tiles) and are what keeps the import
  // on screen while you zoom out to see where it sits.
  zMin = Math.max(Z_MIN_FLOOR, zMin - ZOOM_OUT_HEADROOM);

  // Tile list at zMax over the CLIP's own extent, clip-filtered (see
  // `tilesIntersecting`). It used to range over `transform.wgs84Bounds`, which
  // is baked from the neatline — so any caller passing a clip larger than the
  // neatline silently lost the tiles outside it. Production passes the matching
  // polygon today; the coupling is the bug.
  const tileSpan = worldSize / 2 ** zMax;

  // Source pad: 2 source px in page units.
  const pad = 2 / SRC_PX_PER_PT;
  const affineFastPath =
    transform.planeIsWebMercator && transform.kind === "affine";

  const tiles: TileJob[] = [];
  for (const [tx, ty] of baseTiles) {
    const bounds = tileMercatorBounds(zMax, tx, ty);

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

  return {
    zMin,
    zMax,
    tileSize: TILE_SIZE,
    tiles,
    estimatedTotalTiles: Math.ceil((tiles.length * 4) / 3),
  };
}
