// The arithmetic of a flow network lookup, kept apart from the GeoPackage so
// it can be tested on hand-drawn creeks. Distances are worked in a flat frame
// around the click: within the 50 m snapping range, and along one creek
// segment (tens to hundreds of metres), the error against a geodesic is far
// under a metre, which is far under the 5 m cells the layer was built from.
import {
  FLOW_NETWORK_BIGGER_FACTOR,
  FLOW_NETWORK_SNAP_M,
} from "@logjam/shared";
import type { Position } from "./gpkgGeometry";

/** Mean Earth radius (IUGG), the sphere every metre here is measured on. */
const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180;

/** An equirectangular frame in metres centred on `origin`. */
export function localFrame(origin: Position) {
  const xScale = METRES_PER_DEGREE * Math.cos((origin[1] * Math.PI) / 180);
  return {
    toMetres: ([lon, lat]: Position): Position => [
      (lon - origin[0]) * xScale,
      (lat - origin[1]) * METRES_PER_DEGREE,
    ],
    toDegrees: ([x, y]: Position): Position => [
      origin[0] + x / xScale,
      origin[1] + y / METRES_PER_DEGREE,
    ],
  };
}

/**
 * The [west, south, east, north] box reaching `metres` from a point each way,
 * for the R-tree query that finds candidate creeks.
 */
export function boxAround(point: Position, metres: number) {
  const frame = localFrame(point);
  const [west, south] = frame.toDegrees([-metres, -metres]);
  const [east, north] = frame.toDegrees([metres, metres]);
  return { west, south, east, north };
}

export type NearestOnLine = {
  position: Position;
  distanceM: number;
  /** How far along the line the nearest point is, 0 at its start, 1 at its end. */
  fraction: number;
  /** The index of the vertex that starts the leg the nearest point is on. */
  leg: number;
};

/** The point of a polyline nearest to `point`, or null for a line with no vertices. */
export function nearestOnLine(
  line: readonly Position[],
  point: Position,
): NearestOnLine | null {
  if (line.length === 0) return null;
  const frame = localFrame(point);
  const xy = line.map(frame.toMetres);
  let best = { distance2: Infinity, along: 0, at: xy[0]!, leg: 0 };
  let walked = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i]!;
    const b = xy[i + 1] ?? a;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    // The click is the origin, so a's offset from it is -a.
    const t =
      length2 === 0
        ? 0
        : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length2));
    const at: Position = [a[0] + t * dx, a[1] + t * dy];
    const distance2 = at[0] * at[0] + at[1] * at[1];
    const length = Math.sqrt(length2);
    // Strictly nearer, so a click level with a vertex takes the earlier side
    // and the fraction stays the same either way.
    if (distance2 < best.distance2) {
      best = { distance2, along: walked + t * length, at, leg: i };
    }
    walked += length;
  }
  return {
    position: frame.toDegrees(best.at),
    distanceM: Math.sqrt(best.distance2),
    fraction: walked === 0 ? 0 : best.along / walked,
    leg: best.leg,
  };
}

/**
 * The part of a line from its start down to a point on it: the snapped
 * segment drawn as upstream ends where the click was measured, not at the next
 * junction below.
 */
export function lineDownTo(
  line: readonly Position[],
  nearest: NearestOnLine,
): Position[] {
  return [...line.slice(0, nearest.leg + 1), nearest.position];
}

/**
 * Catchment area at a fraction of the way along a segment. The layer gives it
 * at both ends; area grows along a segment as its banks drain into it, and a
 * straight blend is what the cells between would sum to on an even slope.
 */
export function blend(start: number, end: number, fraction: number): number {
  return start + fraction * (end - start);
}

export type Snapped = { distanceM: number; catchmentKm2: number };

/**
 * The creek a click means: the nearest within FLOW_NETWORK_SNAP_M, and the
 * biggest other creek in range when it drains FLOW_NETWORK_BIGGER_FACTOR times
 * as much, because at a confluence the nearest line is often the tributary and
 * the person meant the river. Null when no creek is in range.
 */
export function chooseCreek<T extends Snapped>(
  candidates: readonly T[],
): { chosen: T; biggerNearby?: T } | null {
  const inRange = candidates.filter((c) => c.distanceM <= FLOW_NETWORK_SNAP_M);
  if (inRange.length === 0) return null;
  // Equally near happens at every junction, where the lines above end on the
  // first vertex of the one below: the bigger is the creek the junction is on.
  const chosen = inRange.reduce((best, c) =>
    c.distanceM < best.distanceM ||
    (c.distanceM === best.distanceM && c.catchmentKm2 > best.catchmentKm2)
      ? c
      : best,
  );
  const bigger = inRange
    .filter(
      (c) =>
        c !== chosen &&
        c.catchmentKm2 >= FLOW_NETWORK_BIGGER_FACTOR * chosen.catchmentKm2,
    )
    .reduce<T | undefined>(
      (best, c) =>
        best === undefined || c.catchmentKm2 > best.catchmentKm2 ? c : best,
      undefined,
    );
  return bigger === undefined ? { chosen } : { chosen, biggerNearby: bigger };
}

/** Even-odd ray casting: inside an odd number of rings is inside. */
function inRings(rings: readonly Position[][], [x, y]: Position): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Whether a point is inside any of the polygons (each outer ring, then holes). */
export function inPolygons(
  polygons: readonly Position[][][],
  point: Position,
): boolean {
  return polygons.some((rings) => inRings(rings, point));
}

/**
 * The upstream segments a response can carry, found without walking more of
 * the catchment than that: the whole walk below the Nepean's outlet is ~400k
 * rows, and node:sqlite runs it on the event loop.
 *
 * `walk(k, limit)` is every upstream segment of Strahler order k or more, at
 * most `limit` of them (null: no limit). Order never falls going downstream,
 * so those segments are still one connected tree of the bigger creeks: the
 * walk can stop at any lower-order segment and lose nothing it wants.
 *
 * Over `cap`, the smallest creeks go first, a whole order at a time, and
 * `trimmedBelowOrder` is the lowest order kept. The clicked segment's own
 * order is always kept, unlimited: above it, segments of that order are one
 * chain (two of them meeting would make the next order), so it is small.
 */
export function walkWithinCap<T>(
  walk: (minOrder: number, limit: number | null) => T[],
  clickedOrder: number,
  cap: number,
): { kept: T[]; trimmedBelowOrder?: number } {
  for (let order = 1; order < clickedOrder; order++) {
    // One over the cap is enough to know it does not fit.
    const kept = walk(order, cap + 1);
    if (kept.length <= cap) {
      return order === 1 ? { kept } : { kept, trimmedBelowOrder: order };
    }
  }
  const kept = walk(clickedOrder, null);
  return clickedOrder <= 1
    ? { kept }
    : { kept, trimmedBelowOrder: clickedOrder };
}

/** [west, south, east, north] of some lines; null when they have no vertices. */
export function bboxOf(
  lines: readonly (readonly Position[])[],
): [number, number, number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const line of lines) {
    for (const [lon, lat] of line) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return west === Infinity ? null : [west, south, east, north];
}
