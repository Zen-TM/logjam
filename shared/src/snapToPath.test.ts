import { describe, it, expect } from "vitest";
import {
  SNAP_MAX_ENTRY_DISTANCE_M,
  buildSnapGraph,
  nearestNode,
  snapSegment,
  type SnapLine,
} from "./snapToPath.js";
import { haversineMeters } from "./canyonGeo.js";
import type { RoutePoint } from "./routeValidation.js";

const LAT = -33.56;
const LON = 150.4;
// ~11.1 m of latitude — a convenient unit for building test geometry.
const M = 1 / 111_320;

/** A line running east from (LON, LAT) with `count` vertices `stepM` apart. */
function eastward(count: number, stepM: number, offsetLatM = 0): SnapLine {
  const coords: RoutePoint[] = [];
  const lonStep = (stepM * M) / Math.cos((LAT * Math.PI) / 180);
  for (let i = 0; i < count; i++) {
    coords.push([LON + lonStep * i, LAT + offsetLatM * M]);
  }
  return { coords };
}

function lengthOf(points: readonly RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(
      points[i - 1]![1],
      points[i - 1]![0],
      points[i]![1],
      points[i]![0],
    );
  }
  return total;
}

describe("buildSnapGraph", () => {
  it("turns a polyline into a chain of connected nodes", () => {
    const graph = buildSnapGraph([eastward(4, 50)]);
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes[0]!.edges.size).toBe(1);
    expect(graph.nodes[1]!.edges.size).toBe(2);
    expect(graph.nodes[3]!.edges.size).toBe(1);
  });

  it("welds a duplicate of the same feature onto one chain", () => {
    // Vector tiles repeat features into neighbouring tile buffers; two copies
    // must not double the graph.
    const line = eastward(4, 50);
    const graph = buildSnapGraph([line, { coords: [...line.coords] }]);
    expect(graph.nodes).toHaveLength(4);
  });

  it("joins two ways whose ends are near but not identical", () => {
    // The spike's central finding: real junctions sit metres apart, not on the
    // same coordinate.
    const first = eastward(3, 50);
    const last = first.coords[first.coords.length - 1]!;
    const second: SnapLine = {
      // Starts 5 m north of where the first ended — inside the weld tolerance.
      coords: [
        [last[0], last[1] + 5 * M],
        [last[0] + 50 * M, last[1] + 5 * M],
      ],
    };
    const graph = buildSnapGraph([first, second]);
    // 3 + 2 vertices, minus the welded pair.
    expect(graph.nodes).toHaveLength(4);
  });

  it("leaves ways further apart than the tolerance disconnected", () => {
    const first = eastward(3, 50);
    const last = first.coords[first.coords.length - 1]!;
    const second: SnapLine = {
      coords: [
        [last[0], last[1] + 100 * M],
        [last[0] + 50 * M, last[1] + 100 * M],
      ],
    };
    const graph = buildSnapGraph([first, second]);
    expect(graph.nodes).toHaveLength(5);
  });

  it("skips non-finite coordinates without joining across the gap", () => {
    const graph = buildSnapGraph([
      {
        coords: [
          [LON, LAT],
          [NaN, NaN] as unknown as RoutePoint,
          [LON + 500 * M, LAT],
        ],
      },
    ]);
    expect(graph.nodes).toHaveLength(2);
    // The two real vertices must NOT have been joined through the bad one.
    expect(graph.nodes[0]!.edges.size).toBe(0);
  });
});

describe("nearestNode", () => {
  it("finds a node beyond the immediate cell neighbourhood", () => {
    // Entry distance (60 m) is wider than the weld cell (12 m), so this only
    // works if the search ring widens.
    const graph = buildSnapGraph([eastward(2, 500)]);
    const found = nearestNode(graph, [LON, LAT + 50 * M], SNAP_MAX_ENTRY_DISTANCE_M);
    expect(found).toBe(0);
  });

  it("returns null when everything is too far", () => {
    const graph = buildSnapGraph([eastward(2, 500)]);
    expect(nearestNode(graph, [LON, LAT + 5000 * M], SNAP_MAX_ENTRY_DISTANCE_M)).toBeNull();
  });
});

describe("snapSegment", () => {
  it("returns null when there are no candidate ways", () => {
    expect(snapSegment([], [LON, LAT], [LON + 500 * M, LAT])).toBeNull();
  });

  it("follows a way between two points near it", () => {
    const track = eastward(11, 50); // 500 m of track
    const from: RoutePoint = [LON, LAT + 10 * M];
    const to: RoutePoint = [track.coords[10]![0], LAT + 10 * M];
    const snapped = snapSegment([track], from, to);
    expect(snapped).not.toBeNull();
    expect(snapped!.length).toBeGreaterThan(2);
  });

  it("prefers the way over the straight line when the way bends", () => {
    // A dog-leg: north 200 m, east 200 m. The straight line is ~283 m; the
    // track is 400 m. Snapping must return the 400 m version.
    const track: SnapLine = {
      coords: [
        [LON, LAT],
        [LON, LAT + 200 * M],
        [LON + (200 * M) / Math.cos((LAT * Math.PI) / 180), LAT + 200 * M],
      ],
    };
    const snapped = snapSegment([track], track.coords[0]!, track.coords[2]!);
    expect(snapped).not.toBeNull();
    expect(lengthOf(snapped!)).toBeGreaterThan(350);
  });

  it("returns null when a tap is far from any way", () => {
    const track = eastward(11, 50);
    const snapped = snapSegment(
      [track],
      [LON, LAT + 1000 * M],
      [track.coords[10]![0], LAT],
    );
    expect(snapped).toBeNull();
  });

  it("returns null when the two ways are not connected", () => {
    const a = eastward(3, 50);
    const b = eastward(3, 50, 500); // parallel, 500 m north
    const snapped = snapSegment([a, b], a.coords[0]!, b.coords[2]!);
    expect(snapped).toBeNull();
  });

  it("rejects an absurd detour rather than drawing it", () => {
    // Two points 100 m apart, joined only by a 3 km loop.
    const loop: SnapLine = {
      coords: [
        [LON, LAT],
        [LON, LAT + 1000 * M],
        [LON + (1000 * M) / Math.cos((LAT * Math.PI) / 180), LAT + 1000 * M],
        [LON + (1000 * M) / Math.cos((LAT * Math.PI) / 180), LAT],
        [LON + (100 * M) / Math.cos((LAT * Math.PI) / 180), LAT],
      ],
    };
    const snapped = snapSegment([loop], loop.coords[0]!, loop.coords[4]!);
    expect(snapped).toBeNull();
  });

  it("returns null when both taps land on the same node", () => {
    const track = eastward(3, 50);
    const snapped = snapSegment([track], track.coords[0]!, [
      track.coords[0]![0] + 1 * M,
      track.coords[0]![1],
    ]);
    expect(snapped).toBeNull();
  });

  it("takes the shorter of two routes to the same place", () => {
    // A 200 m direct link and a 600 m alternative between the same ends.
    const east = (m: number) => (m * M) / Math.cos((LAT * Math.PI) / 180);
    const direct: SnapLine = {
      coords: [
        [LON, LAT],
        [LON + east(200), LAT],
      ],
    };
    const detour: SnapLine = {
      coords: [
        [LON, LAT],
        [LON, LAT + 200 * M],
        [LON + east(200), LAT + 200 * M],
        [LON + east(200), LAT],
      ],
    };
    const snapped = snapSegment([detour, direct], [LON, LAT], [LON + east(200), LAT]);
    expect(snapped).not.toBeNull();
    expect(lengthOf(snapped!)).toBeLessThan(250);
  });

  it("stays fast on a graph the size of a real tile block", () => {
    // The spike saw ~47 features per 3x3 z15 block; this is well past that.
    const lines: SnapLine[] = [];
    for (let i = 0; i < 200; i++) lines.push(eastward(40, 25, i * 30));
    const started = Date.now();
    snapSegment(lines, [LON, LAT], [LON + 900 * M, LAT]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
