import { describe, expect, it } from "vitest";
import type { RecordedTrackPoint } from "@logjam/shared";

import {
  MAX_ELEVATION_VERTICES,
  toElevationGpsFixes,
  toElevationLine,
} from "./trackLine";

// Synthetic coords only (repo rule).
function run(
  count: number,
  segment: number,
  lonBase: number,
): RecordedTrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    lon: lonBase + i * 0.0001,
    lat: -33.6,
    altitudeM: null,
    accuracyM: null,
    timestampMs: i * 1000,
    segment,
  }));
}

describe("toElevationLine", () => {
  it("returns nothing it cannot draw a line from", () => {
    expect(toElevationLine([])).toEqual([]);
    expect(toElevationLine(run(1, 0, 150.2))).toEqual([]);
  });

  it("splits segments and keeps every vertex under the ceiling", () => {
    const line = toElevationLine([...run(3, 0, 150.2), ...run(2, 1, 150.9)]);
    expect(line).toEqual([
      [
        [150.2, -33.6],
        [150.2001, -33.6],
        [150.2002, -33.6],
      ],
      [
        [150.9, -33.6],
        [150.9001, -33.6],
      ],
    ]);
  });

  it("drops a single-point segment as a break rather than a vertex", () => {
    const line = toElevationLine([
      ...run(3, 0, 150.2),
      ...run(1, 1, 150.9),
      ...run(3, 2, 151.4),
    ]);
    expect(line).toHaveLength(2);
    expect(line.flat().some(([lon]) => lon === 150.9)).toBe(false);
  });

  it("keeps a short segment alive when a long one shares the budget", () => {
    // Strided across the flattened series, the 4-point segment wins at most one
    // slot in 200 and is then dropped as a break, silently removing its ground
    // from the sampled line.
    const line = toElevationLine([...run(5000, 0, 150.2), ...run(4, 1, 150.9)]);
    expect(line).toHaveLength(2);
    expect(line[1]).toHaveLength(2);
    expect(line[1]![0]).toEqual([150.9, -33.6]);
    expect(line[1]![1]![0]).toBeCloseTo(150.9003, 9);
  });

  it("holds the whole budget near the ceiling, and spans each segment", () => {
    const line = toElevationLine([
      ...run(5000, 0, 150.2),
      ...run(5000, 1, 150.9),
    ]);
    const total = line.reduce((count, segment) => count + segment.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_ELEVATION_VERTICES);
    expect(line[0]![0]).toEqual([150.2, -33.6]);
    expect(line[0]![line[0]!.length - 1]![0]).toBeCloseTo(
      150.2 + 4999 * 0.0001,
      9,
    );
    expect(line[1]![line[1]!.length - 1]![0]).toBeCloseTo(
      150.9 + 4999 * 0.0001,
      9,
    );
  });
});

describe("the positions toElevationLine reads the DEM at", () => {
  // Mutation: keep the raw fixes and one that jitters up a gorge wall is read
  // at the wall's height, which the DEM profile counts as climb.
  it("are averaged over the fixes either side, the way distance is", () => {
    const points = run(5, 0, 150.2);
    points[2] = { ...points[2]!, lat: -33.6 + 0.001 };
    const line = toElevationLine(points)[0]!;
    expect(line[2]![1]).toBeCloseTo(-33.6 + 0.0002, 9);
    // The ends stay where they were measured.
    expect(line[0]).toEqual([150.2, -33.6]);
    expect(line[4]![1]).toBeCloseTo(-33.6, 9);
  });
});

describe("toElevationGpsFixes", () => {
  const climbing = (count: number, segment: number, lonBase: number) =>
    run(count, segment, lonBase).map((point, i) => ({
      ...point,
      altitudeM: 500 + i,
    }));

  // Mutation: keep only the fixes the line keeps and a filled stretch of a
  // long recording is summed from a fraction of what the phone recorded.
  it("carries every fix, placed among the vertices the line keeps", () => {
    const points = [...climbing(5000, 0, 150.2), ...climbing(4, 1, 150.9)];
    const line = toElevationLine(points);
    const fixes = toElevationGpsFixes(points);
    expect(fixes.map((segment) => segment.length)).toEqual([5000, 4]);
    expect(line[0]!.length).toBeLessThan(5000);
    expect(fixes[0]![0]).toEqual({ vertex: 0, heightM: 500 });
    expect(fixes[0]![4999]!.vertex).toBe(line[0]!.length - 1);
    expect(fixes[1]![3]!.vertex).toBe(line[1]!.length - 1);
    // In walked order, and never past the last vertex.
    const places = fixes[0]!.map((fix) => fix.vertex);
    expect(places.every((at, i) => i === 0 || at > places[i - 1]!)).toBe(true);
  });

  it("smooths a single fix's spike out", () => {
    const points = climbing(5, 0, 150.2);
    points[2] = { ...points[2]!, altitudeM: 9000 };
    const heights = toElevationGpsFixes(points)[0]!.map((fix) => fix.heightM);
    expect(Math.max(...heights)).toBeLessThan(600);
  });

  it("leaves out a fix that carried no height", () => {
    expect(toElevationGpsFixes(run(3, 0, 150.2))).toEqual([[]]);
  });
});
