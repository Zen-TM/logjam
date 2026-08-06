// Snap a drawn segment to nearby trails and creeks.
//
// The problem: a canyoner drawing an approach wants the line to follow the
// actual track, not cut across a gully. Between two tapped points, if both sit
// near mapped ways, walk the ways instead of drawing a straight line.
//
// WHY THIS IS BUILT HERE AND NOT CALLED OUT TO A SERVICE. OSRM, Valhalla and
// GraphHopper each need a preprocessed regional graph behind a running server,
// a public instance would send canyon coordinates off-account, and none of them
// route along waterways at all — which for canyoning is half the point. The
// line data is already on the device inside the vector basemap, so the graph is
// built from that, in memory, per segment. No server, works offline, and the
// coordinates never leave.
//
// The caller supplies the candidate lines and therefore decides what is
// snappable — trails, waterways, or both. Nothing here knows about OSM kinds.
//
// WHAT THE SPIKE FOUND (2026-08-06, Protomaps NSW extract at z15, 3x3 tile
// block over Claustral Canyon): 47 line features, 36 streams and 11 paths, so
// coverage in canyoning country is real. But the features do NOT arrive
// pre-connected — of the endpoint pairs belonging to different features within
// 50 m of each other, only 4 were exactly coincident, with genuine junctions
// sitting 3-15 m apart. Vector tiles also repeat a feature into neighbouring
// tiles' buffers. Both are handled by welding vertices onto a shared spatial
// hash: duplicates collapse onto the same node, and near-misses join.
//
// PRIVACY: the inputs are wilderness coordinates. Nothing here logs.

import { haversineMeters } from "./canyonGeo.js";
import type { RoutePoint } from "./routeValidation.js";

/**
 * Vertices within this distance of each other become one graph node.
 *
 * ponytail: 12 m is a calibrated guess from the spike above, not a
 * measurement. Too small and real junctions stay disconnected so nothing
 * snaps; too large and a creek welds to a track that merely passes overhead,
 * inventing a junction that does not exist on the ground. This is the first
 * knob to turn if snapping either misses obvious junctions or invents silly
 * ones.
 */
export const SNAP_WELD_TOLERANCE_M = 12;

/**
 * How far a tapped point may sit from the nearest mapped way and still snap.
 * Beyond this the user is plainly not pointing at a track, so the straight
 * line is what they meant.
 */
export const SNAP_MAX_ENTRY_DISTANCE_M = 60;

/**
 * Reject a snapped path longer than this multiple of the direct distance.
 * Without it, two points either side of a ridge can snap to a path that runs
 * kilometres around it — technically the shortest way along tracks, and not
 * remotely what the user drew.
 */
export const SNAP_MAX_DETOUR_FACTOR = 4;

/**
 * What a drawn segment may follow. The caller maps these onto whatever its
 * basemap calls trails and creeks; nothing in this module knows about OSM.
 */
export type SnapMode = "off" | "trails" | "waterways" | "both";

/** A candidate way: one polyline, already filtered to a snappable kind. */
export type SnapLine = { coords: readonly RoutePoint[] };

type Node = {
  lon: number;
  lat: number;
  /** Neighbour node index → edge length in metres. */
  edges: Map<number, number>;
};

export type SnapGraph = {
  nodes: Node[];
  /** Spatial hash: cell key → node indices, for nearest-node lookup. */
  cells: Map<string, number[]>;
  cellSizeM: number;
};

/**
 * Degrees of latitude per metre. Longitude is scaled by cos(lat) at use, so
 * cells stay roughly square rather than stretching towards the poles.
 */
const DEG_PER_M_LAT = 1 / 111_320;

function cellKey(cellX: number, cellY: number): string {
  return `${cellX},${cellY}`;
}

function cellOf(
  lon: number,
  lat: number,
  cellSizeM: number,
): { cellX: number; cellY: number } {
  const latSize = cellSizeM * DEG_PER_M_LAT;
  // Guard the pole singularity; cos(lat) → 0 would make lonSize infinite.
  const lonSize = latSize / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return {
    cellX: Math.floor(lon / lonSize),
    cellY: Math.floor(lat / latSize),
  };
}

/** Existing node within tolerance of this position, searching the 3×3 cells. */
function findNode(
  graph: SnapGraph,
  lon: number,
  lat: number,
  toleranceM: number,
): number | null {
  const { cellX, cellY } = cellOf(lon, lat, graph.cellSizeM);
  let best: number | null = null;
  let bestDistance = toleranceM;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = graph.cells.get(cellKey(cellX + dx, cellY + dy));
      if (!bucket) continue;
      for (const index of bucket) {
        const node = graph.nodes[index]!;
        const distance = haversineMeters(lat, lon, node.lat, node.lon);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
    }
  }
  return best;
}

function addNode(graph: SnapGraph, lon: number, lat: number): number {
  const index = graph.nodes.length;
  graph.nodes.push({ lon, lat, edges: new Map() });
  const { cellX, cellY } = cellOf(lon, lat, graph.cellSizeM);
  const key = cellKey(cellX, cellY);
  const bucket = graph.cells.get(key);
  if (bucket) bucket.push(index);
  else graph.cells.set(key, [index]);
  return index;
}

function connect(graph: SnapGraph, a: number, b: number) {
  if (a === b) return;
  const from = graph.nodes[a]!;
  const to = graph.nodes[b]!;
  const length = haversineMeters(from.lat, from.lon, to.lat, to.lon);
  // Keep the shorter edge if the pair is already joined — a duplicated feature
  // must not make the graph worse than one copy of it.
  const known = from.edges.get(b);
  if (known === undefined || length < known) {
    from.edges.set(b, length);
    to.edges.set(a, length);
  }
}

/**
 * Where a point projects onto a segment: the fraction along it, and how far
 * off it the point lies. Done in a local flat-earth frame (metres east/north
 * of the segment start), which over a segment tens of metres long is exact
 * enough and far cheaper than doing it on the sphere.
 */
function projectOntoSegment(
  point: { lon: number; lat: number },
  start: { lon: number; lat: number },
  end: { lon: number; lat: number },
): { t: number; distanceM: number } {
  const metresPerLon = 111_320 * Math.cos((start.lat * Math.PI) / 180);
  const toEast = (lon: number) => (lon - start.lon) * metresPerLon;
  const toNorth = (lat: number) => (lat - start.lat) * 111_320;
  const ex = toEast(end.lon);
  const ny = toNorth(end.lat);
  const px = toEast(point.lon);
  const py = toNorth(point.lat);
  const lengthSquared = ex * ex + ny * ny;
  if (lengthSquared === 0) {
    return { t: 0, distanceM: Math.hypot(px, py) };
  }
  const t = Math.max(0, Math.min(1, (px * ex + py * ny) / lengthSquared));
  return {
    t,
    distanceM: Math.hypot(px - ex * t, py - ny * t),
  };
}

/**
 * Build a routable graph from candidate lines.
 *
 * Two passes, and the second one is what makes this work at all.
 *
 * Pass 1 welds vertices within `weldToleranceM` onto shared nodes. That alone
 * handles duplicate copies of a feature repeated across tile buffers, and ways
 * that meet end-to-end without sharing an exact coordinate.
 *
 * Pass 2 NODES THE NETWORK: a node lying within tolerance of another way's
 * segment is spliced into that segment. Without it the graph is unusable — on
 * the real Protomaps extract around Mount Hay, pass 1 alone produced 764 nodes
 * in 23 disconnected components, and two taps on the same named trail landed
 * in different components so nothing ever snapped. The reason is that a side
 * track meets a main track partway ALONG it, not at one of its vertices, and
 * vertex-to-vertex welding cannot see that junction at any tolerance that
 * doesn't also fuse genuinely separate ways.
 */
export function buildSnapGraph(
  lines: readonly SnapLine[],
  weldToleranceM: number = SNAP_WELD_TOLERANCE_M,
): SnapGraph {
  const graph: SnapGraph = {
    nodes: [],
    cells: new Map(),
    // Cells sized to the tolerance keep the 3×3 neighbourhood search correct:
    // anything within tolerance is guaranteed to be in an adjacent cell.
    cellSizeM: Math.max(1, weldToleranceM),
  };

  // Pass 1 — weld vertices into nodes, remembering each way as a node chain.
  const segments: [number, number][] = [];
  for (const line of lines) {
    let previous: number | null = null;
    for (const [lon, lat] of line.coords) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        previous = null;
        continue;
      }
      const existing = findNode(graph, lon, lat, weldToleranceM);
      const current = existing ?? addNode(graph, lon, lat);
      if (previous !== null && previous !== current) {
        segments.push([previous, current]);
      }
      previous = current;
    }
  }

  // Pass 2 — splice nearby nodes into each segment, then chain the segment
  // through them in order. A segment with no splices just becomes its own edge.
  for (const [startIndex, endIndex] of segments) {
    const start = graph.nodes[startIndex]!;
    const end = graph.nodes[endIndex]!;

    // Candidate nodes: those in any cell the segment passes through, plus a
    // one-cell margin. Walking the cells keeps this local instead of testing
    // every node against every segment.
    const candidates = new Set<number>();
    const startCell = cellOf(start.lon, start.lat, graph.cellSizeM);
    const endCell = cellOf(end.lon, end.lat, graph.cellSizeM);
    for (
      let cellX = Math.min(startCell.cellX, endCell.cellX) - 1;
      cellX <= Math.max(startCell.cellX, endCell.cellX) + 1;
      cellX++
    ) {
      for (
        let cellY = Math.min(startCell.cellY, endCell.cellY) - 1;
        cellY <= Math.max(startCell.cellY, endCell.cellY) + 1;
        cellY++
      ) {
        const bucket = graph.cells.get(cellKey(cellX, cellY));
        if (bucket) for (const index of bucket) candidates.add(index);
      }
    }

    const splices: { index: number; t: number }[] = [];
    for (const index of candidates) {
      if (index === startIndex || index === endIndex) continue;
      const node = graph.nodes[index]!;
      const { t, distanceM } = projectOntoSegment(node, start, end);
      // Endpoints are already the chain's ends; only interior hits add
      // anything.
      if (distanceM <= weldToleranceM && t > 0 && t < 1) {
        splices.push({ index, t });
      }
    }
    splices.sort((a, b) => a.t - b.t);

    let previous = startIndex;
    for (const splice of splices) {
      connect(graph, previous, splice.index);
      previous = splice.index;
    }
    connect(graph, previous, endIndex);
  }

  return graph;
}

/** Nearest node to a position, or null if nothing is within `maxDistanceM`. */
export function nearestNode(
  graph: SnapGraph,
  point: RoutePoint,
  maxDistanceM: number = SNAP_MAX_ENTRY_DISTANCE_M,
): number | null {
  // Widen the ring to cover maxDistanceM. The "+ 1" is not slack: two points d
  // apart can differ by floor(d / cellSize) + 1 cell indices when they straddle
  // a boundary, so ceil(d / cellSize) alone misses a node sitting just past the
  // last ring — which showed up as nothing snapping at 50 m while 40 m worked.
  const rings = Math.ceil(maxDistanceM / graph.cellSizeM) + 1;
  const { cellX, cellY } = cellOf(point[0], point[1], graph.cellSizeM);
  let best: number | null = null;
  let bestDistance = maxDistanceM;
  for (let dx = -rings; dx <= rings; dx++) {
    for (let dy = -rings; dy <= rings; dy++) {
      const bucket = graph.cells.get(cellKey(cellX + dx, cellY + dy));
      if (!bucket) continue;
      for (const index of bucket) {
        const node = graph.nodes[index]!;
        const distance = haversineMeters(
          point[1],
          point[0],
          node.lat,
          node.lon,
        );
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
    }
  }
  return best;
}

/**
 * A* over the graph. The heuristic is straight-line distance to the target,
 * which never overestimates the distance along ways, so the result is optimal.
 *
 * ponytail: the open set is a linear scan for the lowest score rather than a
 * binary heap. These graphs are hundreds of nodes — one tile block's worth of
 * tracks — so the heap would be more code for no measurable gain. Swap it in
 * if the candidate set ever spans a whole region.
 */
function shortestPath(
  graph: SnapGraph,
  startIndex: number,
  goalIndex: number,
): number[] | null {
  const goal = graph.nodes[goalIndex]!;
  const cameFrom = new Map<number, number>();
  const bestKnown = new Map<number, number>([[startIndex, 0]]);
  const heuristic = (index: number) => {
    const node = graph.nodes[index]!;
    return haversineMeters(node.lat, node.lon, goal.lat, goal.lon);
  };
  const open = new Set<number>([startIndex]);

  while (open.size > 0) {
    let current = -1;
    let currentScore = Infinity;
    for (const index of open) {
      const score = (bestKnown.get(index) ?? Infinity) + heuristic(index);
      if (score < currentScore) {
        currentScore = score;
        current = index;
      }
    }
    if (current === goalIndex) {
      const path = [current];
      let step = current;
      while (cameFrom.has(step)) {
        step = cameFrom.get(step)!;
        path.push(step);
      }
      return path.reverse();
    }
    open.delete(current);
    const currentCost = bestKnown.get(current) ?? Infinity;
    for (const [neighbour, length] of graph.nodes[current]!.edges) {
      const candidate = currentCost + length;
      if (candidate < (bestKnown.get(neighbour) ?? Infinity)) {
        cameFrom.set(neighbour, current);
        bestKnown.set(neighbour, candidate);
        open.add(neighbour);
      }
    }
  }
  return null;
}

export type SnapOptions = {
  weldToleranceM?: number;
  maxEntryDistanceM?: number;
  maxDetourFactor?: number;
};

/**
 * Snap the segment `from` → `to` onto the supplied ways.
 *
 * Returns the intermediate points to insert between the two taps — NOT
 * including the taps themselves, so the caller keeps the user's own points
 * exactly where they put them. Returns null whenever snapping should not
 * happen, which the caller renders as the straight line it would have drawn
 * anyway. Null is a normal outcome, not an error: no ways nearby, the taps too
 * far from anything, the ways not actually connected, or a detour so long the
 * user clearly did not mean it.
 */
export function snapSegment(
  lines: readonly SnapLine[],
  from: RoutePoint,
  to: RoutePoint,
  options: SnapOptions = {},
): RoutePoint[] | null {
  const {
    weldToleranceM = SNAP_WELD_TOLERANCE_M,
    maxEntryDistanceM = SNAP_MAX_ENTRY_DISTANCE_M,
    maxDetourFactor = SNAP_MAX_DETOUR_FACTOR,
  } = options;

  if (lines.length === 0) return null;
  const graph = buildSnapGraph(lines, weldToleranceM);
  const startIndex = nearestNode(graph, from, maxEntryDistanceM);
  const goalIndex = nearestNode(graph, to, maxEntryDistanceM);
  if (startIndex === null || goalIndex === null) return null;
  if (startIndex === goalIndex) return null;

  const path = shortestPath(graph, startIndex, goalIndex);
  if (!path) return null;

  const points: RoutePoint[] = path.map((index) => {
    const node = graph.nodes[index]!;
    return [node.lon, node.lat];
  });

  let snappedLength = 0;
  for (let i = 1; i < points.length; i++) {
    snappedLength += haversineMeters(
      points[i - 1]![1],
      points[i - 1]![0],
      points[i]![1],
      points[i]![0],
    );
  }
  const directLength = haversineMeters(from[1], from[0], to[1], to[0]);
  // A very short direct hop has no meaningful ratio (dividing by ~0 rejects
  // everything), so only apply the detour guard once there is a real baseline.
  if (directLength > 1 && snappedLength > directLength * maxDetourFactor) {
    return null;
  }
  return points;
}
