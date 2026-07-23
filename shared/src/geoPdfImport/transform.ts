// Page ↔ world transform built from GeoPDF control points (Stage 6 Part B).
//
// Model (§3 of the stage spec): pick a working plane P —
//   • PROJCS → that projection (affine page→P is exact for any correctly
//     rendered projected map, including rotated grid-north-up sheets);
//   • GEOGCS → EPSG:3857 (exact for Logjam exports, whose page raster is an
//     affine image of Web Mercator; bow error for hypothetical plate-carrée
//     files is sub-line-width at canyon scale).
// Fit a least-squares affine on the control points; if n = 4 and the residual
// exceeds 0.1 % of the map width, fall back to an exact projective homography.
import proj4 from "proj4";

import { GeoPdfParseError, type GeoPdfViewport } from "./parseGeoref.js";
import { resolveCrs } from "./crs.js";

export interface XY {
  x: number;
  y: number;
}

export interface LonLat {
  lon: number;
  lat: number;
}

export interface GeoTransform {
  kind: "affine" | "homography";
  /** "EPSG:3857", "EPSG:nnnn", or "WKT" — diagnostics only. */
  planeCrs: string;
  planeIsWebMercator: boolean;
  pageToPlane(p: XY): XY;
  planeToPage(q: XY): XY;
  pageToLonLat(p: XY): LonLat;
  lonLatToPage(g: LonLat): XY;
  /** EPSG:3857 metres. */
  pageToMercator(p: XY): XY;
  mercatorToPage(m: XY): XY;
  maxResidualPlaneUnits: number;
  maxResidualFractionOfWidth: number;
  /** BBox of the clip polygon (Bounds neatline or viewport BBox) in WGS84. */
  wgs84Bounds: { north: number; south: number; east: number; west: number };
}

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const WEB_MERCATOR =
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs";

/** Residual fraction beyond which a 4-point fit upgrades to a homography. */
const HOMOGRAPHY_THRESHOLD = 0.001;
/** Residual fraction beyond which the caller must warn the user (§3.2). */
export const RESIDUAL_WARN_FRACTION = 0.005;

/** Row-major n×n Gaussian elimination with partial pivoting. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new GeoPdfParseError("MALFORMED_GEOREF", "singular system in transform fit");
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / a[i][i]);
}

interface AffineFit {
  // q.x = a·p.x + b·p.y + c ; q.y = d·p.x + e·p.y + f
  m: [number, number, number, number, number, number];
  maxResidual: number;
}

function fitAffine(pagePts: XY[], planePts: XY[]): AffineFit {
  // Centre both point sets for numerical stability (plane coords reach 1e7).
  const n = pagePts.length;
  const pc = { x: 0, y: 0 };
  const qc = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    pc.x += pagePts[i].x / n;
    pc.y += pagePts[i].y / n;
    qc.x += planePts[i].x / n;
    qc.y += planePts[i].y / n;
  }
  // Normal equations over centred coords: solve 2×(3 unknowns), shared matrix.
  let sxx = 0,
    sxy = 0,
    syy = 0;
  const bx = [0, 0];
  const by = [0, 0];
  for (let i = 0; i < n; i++) {
    const px = pagePts[i].x - pc.x;
    const py = pagePts[i].y - pc.y;
    const qx = planePts[i].x - qc.x;
    const qy = planePts[i].y - qc.y;
    sxx += px * px;
    sxy += px * py;
    syy += py * py;
    bx[0] += px * qx;
    bx[1] += py * qx;
    by[0] += px * qy;
    by[1] += py * qy;
  }
  const [a, b] = solveLinear(
    [
      [sxx, sxy],
      [sxy, syy],
    ],
    bx,
  );
  const [d, e] = solveLinear(
    [
      [sxx, sxy],
      [sxy, syy],
    ],
    by,
  );
  const c = qc.x - a * pc.x - b * pc.y;
  const f = qc.y - d * pc.x - e * pc.y;

  let maxResidual = 0;
  for (let i = 0; i < n; i++) {
    const rx = a * pagePts[i].x + b * pagePts[i].y + c - planePts[i].x;
    const ry = d * pagePts[i].x + e * pagePts[i].y + f - planePts[i].y;
    maxResidual = Math.max(maxResidual, Math.hypot(rx, ry));
  }
  return { m: [a, b, c, d, e, f], maxResidual };
}

/** 3×3 row-major homography H with H[8] = 1: q = (H·[p,1]) dehomogenised. */
function fitHomography(pagePts: XY[], planePts: XY[]): number[] {
  // Normalise both sets (centroid → origin, mean distance → √2) then DLT.
  const normalise = (pts: XY[]) => {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const meanDist =
      pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
    const s = Math.SQRT2 / (meanDist || 1);
    return {
      apply: (p: XY): XY => ({ x: (p.x - cx) * s, y: (p.y - cy) * s }),
      // T maps original → normalised
      T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1],
    };
  };
  const np = normalise(pagePts);
  const nq = normalise(planePts);
  const P = pagePts.map(np.apply);
  const Q = planePts.map(nq.apply);

  // DLT: 2 equations per correspondence, 8 unknowns (h8 = 1).
  const A: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = P[i];
    const { x: u, y: v } = Q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const h = [...solveLinear(A, rhs), 1];

  // Denormalise: H = inv(Tq) · Hn · Tp
  const mul = (a: number[], b: number[]) => {
    const out = new Array<number>(9).fill(0);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    return out;
  };
  return mul(mul(invert3x3(nq.T), h), np.T);
}

function invert3x3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-15) {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "singular homography");
  }
  return [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

function applyHomography(h: number[], p: XY): XY {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function buildGeoTransform(vp: GeoPdfViewport): GeoTransform {
  const resolved = resolveCrs(vp.crs);
  // Working plane: the PROJCS itself, or Web Mercator for geographic CRSs.
  const planeIsWebMercator = resolved.isGeographic || resolved.isWebMercator;
  const planeDef = planeIsWebMercator ? WEB_MERCATOR : resolved.def;
  const planeCrs = planeIsWebMercator ? "EPSG:3857" : resolved.key;

  // Build the proj4 converters ONCE: constructing one from a WKT string
  // parses the WKT — doing that per point made tile planning ~50× slower.
  const wgs84ToPlane = proj4(WGS84, planeDef);
  const wgs84ToMercator = proj4(WGS84, WEB_MERCATOR);

  const pagePts = vp.controlPoints.map((cp) => cp.pagePt);
  const planePts = vp.controlPoints.map((cp) => {
    const [x, y] = wgs84ToPlane.forward([cp.lonLat.lon, cp.lonLat.lat]);
    return { x, y };
  });

  const xs = planePts.map((q) => q.x);
  const ys = planePts.map((q) => q.y);
  const mapWidth = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  if (!(mapWidth > 0)) {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "control points are coincident in the plane");
  }

  const affine = fitAffine(pagePts, planePts);
  let kind: "affine" | "homography" = "affine";
  let maxResidual = affine.maxResidual;
  let forwardH: number[] | undefined;
  let inverseH: number[] | undefined;

  if (
    vp.controlPoints.length === 4 &&
    affine.maxResidual / mapWidth > HOMOGRAPHY_THRESHOLD
  ) {
    kind = "homography";
    forwardH = fitHomography(pagePts, planePts);
    inverseH = invert3x3(forwardH);
    maxResidual = 0;
    for (let i = 0; i < 4; i++) {
      const q = applyHomography(forwardH, pagePts[i]);
      maxResidual = Math.max(
        maxResidual,
        Math.hypot(q.x - planePts[i].x, q.y - planePts[i].y),
      );
    }
  }

  const [a, b, c, d, e, f] = affine.m;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-15) {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "degenerate affine transform");
  }

  const pageToPlane = (p: XY): XY =>
    forwardH
      ? applyHomography(forwardH, p)
      : { x: a * p.x + b * p.y + c, y: d * p.x + e * p.y + f };
  const planeToPage = (q: XY): XY => {
    if (inverseH) return applyHomography(inverseH, q);
    const qx = q.x - c;
    const qy = q.y - f;
    return { x: (e * qx - b * qy) / det, y: (a * qy - d * qx) / det };
  };

  const planeToLonLat = (q: XY): LonLat => {
    const [lon, lat] = wgs84ToPlane.inverse([q.x, q.y]);
    return { lon, lat };
  };
  const lonLatToPlane = (g: LonLat): XY => {
    const [x, y] = wgs84ToPlane.forward([g.lon, g.lat]);
    return { x, y };
  };
  const pageToLonLat = (p: XY): LonLat => planeToLonLat(pageToPlane(p));
  const lonLatToPage = (g: LonLat): XY => planeToPage(lonLatToPlane(g));

  const pageToMercator = planeIsWebMercator
    ? pageToPlane
    : (p: XY): XY => {
        const g = pageToLonLat(p);
        const [x, y] = wgs84ToMercator.forward([g.lon, g.lat]);
        return { x, y };
      };
  const mercatorToPage = planeIsWebMercator
    ? planeToPage
    : (m: XY): XY => {
        const [lon, lat] = wgs84ToMercator.inverse([m.x, m.y]);
        return lonLatToPage({ lon, lat });
      };

  // WGS84 bounds of the clip polygon (neatline if present, else BBox corners).
  const clip =
    vp.boundsPolygonPt ??
    [
      { x: vp.bboxPt.x0, y: vp.bboxPt.y0 },
      { x: vp.bboxPt.x1, y: vp.bboxPt.y0 },
      { x: vp.bboxPt.x1, y: vp.bboxPt.y1 },
      { x: vp.bboxPt.x0, y: vp.bboxPt.y1 },
    ];
  let north = -Infinity,
    south = Infinity,
    east = -Infinity,
    west = Infinity;
  for (const p of clip) {
    const g = pageToLonLat(p);
    north = Math.max(north, g.lat);
    south = Math.min(south, g.lat);
    east = Math.max(east, g.lon);
    west = Math.min(west, g.lon);
  }

  return {
    kind,
    planeCrs,
    planeIsWebMercator,
    pageToPlane,
    planeToPage,
    pageToLonLat,
    lonLatToPage,
    pageToMercator,
    mercatorToPage,
    maxResidualPlaneUnits: maxResidual,
    maxResidualFractionOfWidth: maxResidual / mapWidth,
    wgs84Bounds: { north, south, east, west },
  };
}
