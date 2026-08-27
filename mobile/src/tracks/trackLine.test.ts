import { describe, expect, it } from "vitest";
import type { RecordedTrackPoint } from "@logjam/shared";

import { MAX_ELEVATION_VERTICES, toElevationLine } from "./trackLine";

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
    const line = toElevationLine([
      ...run(5000, 0, 150.2),
      ...run(4, 1, 150.9),
    ]);
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
    expect(line[0]![line[0]!.length - 1]![0]).toBeCloseTo(150.2 + 4999 * 0.0001, 9);
    expect(line[1]![line[1]!.length - 1]![0]).toBeCloseTo(150.9 + 4999 * 0.0001, 9);
  });
});
