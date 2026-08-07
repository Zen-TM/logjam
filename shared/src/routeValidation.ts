// Single source of truth for Route geometry: caps, validation, derived stats,
// simplification, and the GPX/KML/GeoJSON → routes import plan. Shared by the
// API (routes/routes.ts, routes/sync.ts) and both clients (draw tools, import
// flows, outbox validation before enqueue). Mirrors waypointValidation.ts's
// payload-validator shape.
//
// A Route is an INTENTION — authored, edited, small. It is not a recording.
// Recorded GPS tracks keep their timestamps, duration and segments and live
// elsewhere (see trackStats.ts); the only bridge is simplifyToFit, used by the
// deliberate "create route from recording" action.
//
// PRIVACY: like IMPORT_ERRORS in vectorImport.ts, every error string here is
// STATIC — it must never echo a coordinate or a file's contents.

import { haversineMeters } from "./canyonGeo.js";
import {
  isValidLatitude,
  isValidLongitude,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
} from "./canyonValidation.js";
import {
  IMPORT_ERRORS,
  type ImportedFeature,
  type ImportedGeometry,
  type ImportedPosition,
  type VectorImportResult,
} from "./vectorImport.js";

/**
 * Maximum vertices in one route. DERIVED, not arbitrary: the API caps request
 * bodies at 1 MB (api/src/index.ts, `express.json({ limit: "1mb" })`) and one
 * sync push batch carries up to SYNC_PUSH_MAX_OPS = 50 ops, giving ~20 KB per
 * op. A 6-decimal-place [lon, lat] pair is ~24 bytes of JSON, so 20 KB ≈ 1000
 * points. Raising this means raising the body limit AND giving routes a byte
 * budget in the delta fill — not a one-line change.
 */
export const MAX_ROUTE_POINTS = 1000;
/** A line needs two ends. */
export const MIN_ROUTE_POINTS = 2;
export const ROUTE_NAME_MAX_LENGTH = 200;

/** Stored coordinate precision. ~11 cm at this latitude — far finer than a
 * tapped vertex, and what the byte-budget maths above assumes. */
export const ROUTE_COORD_DECIMALS = 6;

/** [lon, lat] — GeoJSON axis order, matching ImportedPosition. */
export type RoutePoint = [number, number];

export const ROUTE_ERRORS = {
  pointsRequired: "points is required",
  pointsShape: "points must be an array of [longitude, latitude] pairs",
  tooFewPoints: `A route needs at least ${MIN_ROUTE_POINTS} points`,
  tooManyPoints: `A route can have at most ${MAX_ROUTE_POINTS} points`,
  nameRequired: "name is required",
  nameTooLong: `name must be at most ${ROUTE_NAME_MAX_LENGTH} characters`,
  anchorsShape: "anchors must be an array of point indices",
} as const;

export type RouteFieldPayload = {
  name?: unknown;
  points?: unknown;
  anchors?: unknown;
};

/** Round to ROUTE_COORD_DECIMALS without string round-tripping. */
function roundCoord(value: number): number {
  const factor = 10 ** ROUTE_COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Narrow unknown input to RoutePoint[], or return the static error describing
 * why it isn't. Coordinates are rounded to ROUTE_COORD_DECIMALS and any third
 * element (elevation, from an imported file) is dropped — a Route stores
 * geometry only, and elevation is derived on demand once a DEM exists.
 */
/**
 * Validate an anchor-index list against the points it indexes.
 *
 * Deliberately strict — ascending, in range, and spanning both ends — because a
 * malformed list would silently mis-attribute which vertices the user placed,
 * and the client would then let them drag a snapped vertex or refuse to let
 * them drag their own. Callers treat a rejection as "no record" rather than an
 * error, which degrades to every-point-is-an-anchor.
 */
export function parseRouteAnchors(
  value: unknown,
  pointCount: number,
): { anchors: number[] | null } | { error: string } {
  if (value === undefined || value === null) return { anchors: null };
  if (!Array.isArray(value)) return { error: ROUTE_ERRORS.anchorsShape };
  if (value.length < 2 || value.length > pointCount) {
    return { error: ROUTE_ERRORS.anchorsShape };
  }
  const anchors: number[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "number" ||
      !Number.isInteger(entry) ||
      entry < 0 ||
      entry >= pointCount
    ) {
      return { error: ROUTE_ERRORS.anchorsShape };
    }
    if (anchors.length > 0 && entry <= anchors[anchors.length - 1]!) {
      return { error: ROUTE_ERRORS.anchorsShape };
    }
    anchors.push(entry);
  }
  if (anchors[0] !== 0 || anchors[anchors.length - 1] !== pointCount - 1) {
    return { error: ROUTE_ERRORS.anchorsShape };
  }
  return { anchors };
}

export function parseRoutePoints(
  value: unknown,
): { points: RoutePoint[] } | { error: string } {
  if (!Array.isArray(value)) return { error: ROUTE_ERRORS.pointsShape };
  if (value.length < MIN_ROUTE_POINTS) return { error: ROUTE_ERRORS.tooFewPoints };
  if (value.length > MAX_ROUTE_POINTS) return { error: ROUTE_ERRORS.tooManyPoints };

  const points: RoutePoint[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) {
      return { error: ROUTE_ERRORS.pointsShape };
    }
    const [lon, lat] = entry as unknown[];
    // Note the axis flip against the validators: they are named for lat/lng,
    // the array is GeoJSON [lon, lat].
    if (!isValidLongitude(lon)) {
      return {
        error: `Longitude must be a number between ${LONGITUDE_RANGE.min} and ${LONGITUDE_RANGE.max}`,
      };
    }
    if (!isValidLatitude(lat)) {
      return {
        error: `Latitude must be a number between ${LATITUDE_RANGE.min} and ${LATITUDE_RANGE.max}`,
      };
    }
    points.push([roundCoord(lon), roundCoord(lat)]);
  }
  return { points };
}

/**
 * Validate a route create/update payload. Returns the first user-facing error
 * string, or null when everything is valid.
 *
 * - `requireCore: true` (create) demands name AND points.
 * - `requireCore: false` (patch) validates fields only when supplied.
 *
 * `canyonId` is NOT validated here — resolving it requires a DB lookup scoped
 * to the caller (see resolveCanyonAssociation in the API route).
 */
export function validateRoutePayload(
  payload: RouteFieldPayload,
  opts: { requireCore: boolean },
): string | null {
  const { name, points } = payload;

  if (opts.requireCore || name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return ROUTE_ERRORS.nameRequired;
    }
    if (name.trim().length > ROUTE_NAME_MAX_LENGTH) {
      return ROUTE_ERRORS.nameTooLong;
    }
  }
  if (opts.requireCore || points !== undefined) {
    if (points === undefined) return ROUTE_ERRORS.pointsRequired;
    const parsed = parseRoutePoints(points);
    if ("error" in parsed) return parsed.error;
    // Anchors are only checkable against the points they index, so they are
    // validated here rather than independently. A PATCH that moves points must
    // therefore carry matching anchors or clear them.
    if (payload.anchors !== undefined) {
      const anchors = parseRouteAnchors(payload.anchors, parsed.points.length);
      if ("error" in anchors) return anchors.error;
    }
  } else if (payload.anchors !== undefined && payload.anchors !== null) {
    // Anchors without points would index geometry we cannot see from here.
    return ROUTE_ERRORS.anchorsShape;
  }
  return null;
}

/**
 * Route length in metres. DERIVED on read, never stored — a persisted length
 * goes stale the moment a vertex moves.
 */
export function routeLengthM(points: readonly RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [fromLon, fromLat] = points[i - 1]!;
    const [toLon, toLat] = points[i]!;
    total += haversineMeters(fromLat, fromLon, toLat, toLon);
  }
  return total;
}

/**
 * Structural GeoJSON line feature. Declared locally rather than pulled from
 * `@types/geojson` — shared/ has no DOM/GeoJSON ambient types (see
 * vectorImport.ts, which declares its own geometry shapes for the same
 * reason), and this is assignable to the real type at both call sites.
 */
export type RouteLineFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: RoutePoint[] };
  properties: Record<string, unknown>;
};

/** One LineString Feature, for a MapLibre ShapeSource / GeoJSON source. */
export function routeToGeoJson(
  points: readonly RoutePoint[],
  properties: Record<string, unknown> = {},
): RouteLineFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: points.map((p): RoutePoint => [p[0], p[1]]),
    },
    properties,
  };
}

/**
 * Reverse the vertex order. Direction is semantic for canyoning — upstream vs
 * downstream, approach vs exit — and the order IS the data.
 */
export function reverseRoute(points: readonly RoutePoint[]): RoutePoint[] {
  return points.map((p): RoutePoint => [p[0], p[1]]).reverse();
}

// ── Simplification ───────────────────────────────────────────────────────────
//
// Ramer–Douglas–Peucker. Used by exactly two deliberate, user-visible actions:
// importing an over-cap line, and creating a route from a recording. Drawn
// routes are never silently simplified — the user placed those vertices.

/**
 * Perpendicular distance from `point` to the segment `start`–`end`, in metres.
 *
 * ponytail: the segment is treated as planar with longitude scaled by
 * cos(latitude), which is exact enough at the scale of one route (tens of km)
 * and avoids a great-circle cross-track term. Upgrade only if routes ever span
 * degrees of latitude.
 */
function perpendicularDistanceM(
  point: RoutePoint,
  start: RoutePoint,
  end: RoutePoint,
): number {
  const lonScale = Math.cos((point[1] * Math.PI) / 180);
  // Degrees → metres, so the tolerance argument is a real distance.
  const metresPerDegree = 111_320;
  const px = (point[0] - start[0]) * lonScale * metresPerDegree;
  const py = (point[1] - start[1]) * metresPerDegree;
  const ex = (end[0] - start[0]) * lonScale * metresPerDegree;
  const ey = (end[1] - start[1]) * metresPerDegree;

  const segmentLengthSq = ex * ex + ey * ey;
  if (segmentLengthSq === 0) return Math.hypot(px, py);
  // Projection parameter, clamped so a point beyond either end measures to
  // that end rather than to the infinite line.
  const t = Math.max(0, Math.min(1, (px * ex + py * ey) / segmentLengthSq));
  return Math.hypot(px - t * ex, py - t * ey);
}

/**
 * Ramer–Douglas–Peucker at a fixed tolerance in metres. Endpoints are kept.
 *
 * ponytail: O(n·log n) on real tracks but O(n²) worst case, when almost every
 * vertex deviates past the tolerance (a tight zigzag against a small
 * tolerance). Callers that accept unbounded input must decimate first — see
 * SIMPLIFY_INPUT_CEILING in simplifyToFit. Upgrade to a segment-indexed
 * variant only if a real track ever hits the quadratic path.
 */
export function simplifyRoute(
  points: readonly RoutePoint[],
  toleranceM: number,
): RoutePoint[] {
  if (points.length <= 2 || toleranceM <= 0) {
    return points.map((p): RoutePoint => [p[0], p[1]]);
  }
  // Iterative rather than recursive: a 100k-point recording would blow the
  // stack on the naive recursion, and this runs on a phone.
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let furthest = -1;
    let furthestDistance = toleranceM;
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistanceM(points[i]!, points[first]!, points[last]!);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthest = i;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = true;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  const result: RoutePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push([points[i]![0], points[i]![1]]);
  }
  return result;
}

export type SimplifyToFitResult = {
  points: RoutePoint[];
  /** Tolerance that achieved the fit, in metres. 0 = no simplification needed. */
  toleranceM: number;
  /** How many vertices were discarded, so the UI can report the cost. */
  droppedCount: number;
};

/**
 * Vertices fed to RDP, as a multiple of the target. simplifyToFit accepts
 * unbounded input — a vector import may carry up to MAX_IMPORT_POSITIONS
 * (500k) — and RDP's worst case is quadratic, which would hang a phone. Since
 * the result can never exceed `maxPoints` anyway, anything above this is
 * stride-decimated first: the discarded vertices could not have survived, and
 * the bound keeps the quadratic path down to a few million operations.
 */
const SIMPLIFY_INPUT_CEILING_FACTOR = 4;

/** Evenly-spaced subsample keeping both endpoints. */
function decimateTo(points: readonly RoutePoint[], target: number): RoutePoint[] {
  if (points.length <= target) return points.map((p): RoutePoint => [p[0], p[1]]);
  const stride = (points.length - 1) / (target - 1);
  const out: RoutePoint[] = [];
  for (let i = 0; i < target - 1; i++) {
    const point = points[Math.round(i * stride)]!;
    out.push([point[0], point[1]]);
  }
  const last = points[points.length - 1]!;
  out.push([last[0], last[1]]);
  return out;
}

/**
 * Simplify until the route fits MAX_ROUTE_POINTS, escalating the tolerance.
 * Returns the tolerance used so the caller can tell the user how much detail
 * was traded away.
 *
 * Input under the cap is returned untouched at tolerance 0 — this must never
 * quietly reshape a route that was already legal.
 *
 * `droppedCount` counts against the ORIGINAL input, including anything lost to
 * the pre-decimation above, so the number the UI shows is the true cost.
 */
export function simplifyToFit(
  points: readonly RoutePoint[],
  maxPoints: number = MAX_ROUTE_POINTS,
): SimplifyToFitResult {
  const inputCount = points.length;
  if (inputCount <= maxPoints) {
    return {
      points: points.map((p): RoutePoint => [p[0], p[1]]),
      toleranceM: 0,
      droppedCount: 0,
    };
  }
  const original = decimateTo(points, maxPoints * SIMPLIFY_INPUT_CEILING_FACTOR);
  // Geometric escalation from 1 m. A 4000-point day track typically fits by
  // ~8-16 m, so this lands in a handful of passes; the ceiling exists so a
  // pathological input can't loop forever.
  let toleranceM = 1;
  let simplified = original;
  for (let attempt = 0; attempt < 24; attempt++) {
    simplified = simplifyRoute(original, toleranceM);
    if (simplified.length <= maxPoints) {
      return {
        points: simplified,
        toleranceM,
        droppedCount: inputCount - simplified.length,
      };
    }
    toleranceM *= 2;
  }
  // RDP can't go below the two endpoints, so this is unreachable for any real
  // input; truncating rather than throwing keeps the import flow alive.
  const truncated = simplified.slice(0, maxPoints);
  return {
    points: truncated,
    toleranceM,
    droppedCount: inputCount - truncated.length,
  };
}

// ── Import planning ──────────────────────────────────────────────────────────

export type RouteImportDraft = {
  /** From the feature/document name; the UI may let the user rename. */
  name: string | null;
  points: RoutePoint[];
  /** True when this draft came in over the cap and needs a simplify/keep choice. */
  overCap: boolean;
  /** Vertex count before any simplification — what to show in the choice. */
  originalPointCount: number;
};

export type RouteImportPlan = {
  drafts: RouteImportDraft[];
  /** Non-line geometry that cannot become a route, for the "we dropped X" notice. */
  dropped: { points: number; polygons: number };
};

/** Flatten a geometry into the line strings it contains. Non-lines are counted,
 * not converted — a polygon is not a route, and a lone waypoint is not either. */
function lineStringsOf(
  geometry: ImportedGeometry,
  dropped: { points: number; polygons: number },
): ImportedPosition[][] {
  switch (geometry.type) {
    case "LineString":
      return [geometry.coordinates];
    case "MultiLineString":
      return geometry.coordinates;
    case "Point":
      dropped.points += 1;
      return [];
    case "MultiPoint":
      dropped.points += geometry.coordinates.length;
      return [];
    case "Polygon":
      dropped.polygons += 1;
      return [];
    case "MultiPolygon":
      dropped.polygons += geometry.coordinates.length;
      return [];
  }
}

function draftFrom(
  positions: ImportedPosition[],
  name: string | null,
): RouteImportDraft | null {
  // Drop the elevation third element if present — geometry only.
  const points: RoutePoint[] = [];
  for (const position of positions) {
    const [lon, lat] = position;
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    points.push([roundCoord(lon), roundCoord(lat)]);
  }
  if (points.length < MIN_ROUTE_POINTS) return null;
  return {
    name,
    points,
    overCap: points.length > MAX_ROUTE_POINTS,
    originalPointCount: points.length,
  };
}

/**
 * Turn a parsed vector file into route drafts — ONE PER LINE, so a multi-track
 * GPX imports as several routes rather than being refused. Polygons and lone
 * points are dropped and counted (same call the GPX exporter makes in
 * topo/renderers/gpx.py, for the same reason: a route is a line).
 *
 * Over-cap drafts are returned flagged rather than simplified, so the caller
 * can offer the choice (simplify to fit, or keep the original as a file).
 *
 * Throws IMPORT_ERRORS.noFeatures when nothing line-shaped survives, matching
 * how parseVectorImport reports an unusable file.
 */
export function routesFromVectorImport(
  result: VectorImportResult,
): RouteImportPlan {
  const dropped = { points: 0, polygons: 0 };
  const drafts: RouteImportDraft[] = [];

  for (const feature of result.features as ImportedFeature[]) {
    const featureName = feature.properties?.name ?? null;
    for (const positions of lineStringsOf(feature.geometry, dropped)) {
      // Document name is the fallback only when the feature is anonymous, and
      // only meaningful for a single-line file; multi-line files get indexed
      // names by the caller from the null.
      const draft = draftFrom(positions, featureName ?? result.name);
      if (draft) drafts.push(draft);
    }
  }

  if (drafts.length === 0) throw new Error(IMPORT_ERRORS.noFeatures);
  return { drafts, dropped };
}
