import { describe, expect, it } from "vitest";

import { trackPassesNear } from "./trackPasses.js";
import type { TrackSeriesPoint } from "./trackStats.js";

// Synthetic coords only (repo rule): 150.2–150.3 E, −33.6–−33.7 S.
const LAT = -33.65;
const LON = 150.25;
/** 0.001° of latitude is about 111 m. */
const at = (
  milliDegNorth: number,
  minutes: number,
  segment = 0,
): TrackSeriesPoint => ({
  lat: LAT + milliDegNorth * 0.001,
  lon: LON,
  altitudeM: null,
  timestampMs: minutes * 60_000,
  segment,
});

describe("trackPassesNear", () => {
  // Red when the closest FIX is used instead of the closest point on the line
  // between fixes: the answer snaps to minute 0 or minute 10.
  it("reads the time off the line between two fixes", () => {
    const passes = trackPassesNear([at(0, 0), at(10, 10)], {
      lat: LAT + 0.004,
      lon: LON + 0.0001,
    });
    expect(passes).toHaveLength(1);
    expect(passes[0]!.atMs).toBeCloseTo(4 * 60_000, -2);
  });

  // Red when only the nearest approach is returned: the way back disappears.
  it("finds both legs of an out and back", () => {
    const track = [at(0, 0), at(5, 30), at(10, 60), at(5, 90), at(0, 120)];
    const passes = trackPassesNear(track, { lat: LAT + 0.005, lon: LON });
    expect(passes.map((pass) => pass.atMs / 60_000)).toEqual([30, 90]);
  });

  // Red when nearby visits are not merged: a lunch stop reads as many passes.
  it("reports a stop as one visit with its length", () => {
    const track = [
      at(0, 0),
      at(5, 30),
      at(5.01, 33),
      at(4.99, 36),
      at(5, 60),
      at(10, 90),
    ];
    const passes = trackPassesNear(track, { lat: LAT + 0.005, lon: LON });
    expect(passes).toHaveLength(1);
    expect(passes[0]!.fromMs).toBeLessThanOrEqual(30 * 60_000);
    expect(passes[0]!.toMs).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it("does not count the gap across a pause as somewhere the track was", () => {
    const track = [at(0, 0), at(1, 10), at(9, 20, 1), at(10, 30, 1)];
    const passes = trackPassesNear(track, { lat: LAT + 0.005, lon: LON });
    // Nearest drawn line is 4 mdeg away at either end; the midpoint time (15)
    // belongs to no interval.
    expect(passes.map((pass) => pass.atMs / 60_000)).toEqual([10, 20]);
  });

  it("has no answer for a series without timestamps", () => {
    const untimed = [at(0, 0), at(10, 10)].map((point) => ({
      ...point,
      timestampMs: null,
    }));
    expect(trackPassesNear(untimed, { lat: LAT, lon: LON })).toEqual([]);
    expect(trackPassesNear([at(0, 0)], { lat: LAT, lon: LON })).toEqual([]);
  });
});
