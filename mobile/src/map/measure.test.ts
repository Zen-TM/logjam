import { describe, it, expect } from "vitest";

import {
  measureShape,
  measureStats,
  nearestContourElevation,
  type MeasurePoint,
} from "./measure";

function point(
  id: number,
  longitude: number,
  latitude: number,
  elevationM: number | null = null,
): MeasurePoint {
  return { id, longitude, latitude, elevationM };
}

describe("measureStats", () => {
  it("is empty for fewer than two points", () => {
    expect(measureStats([])).toEqual({
      distanceM: 0,
      gainM: null,
      lossM: null,
      elevationComplete: true,
    });
    expect(measureStats([point(1, 150.3, -33.7)]).distanceM).toBe(0);
  });

  it("sums leg distances, not the straight line end to end", () => {
    // Right-angle path: east then north. The direct hop would be shorter.
    const stats = measureStats([
      point(1, 150.3, -33.7),
      point(2, 150.31, -33.7),
      point(3, 150.31, -33.69),
    ]);
    expect(stats.distanceM).toBeGreaterThan(2000);
    expect(stats.distanceM).toBeCloseTo(925.6 + 1111.9, 0);
  });

  it("splits elevation deltas into gain and loss", () => {
    const stats = measureStats([
      point(1, 150.3, -33.7, 700),
      point(2, 150.31, -33.7, 780),
      point(3, 150.32, -33.7, 730),
      point(4, 150.33, -33.7, 760),
    ]);
    expect(stats.gainM).toBe(110);
    expect(stats.lossM).toBe(50);
    expect(stats.elevationComplete).toBe(true);
  });

  it("skips legs with a missing height and flags the readout incomplete", () => {
    const stats = measureStats([
      point(1, 150.3, -33.7, 700),
      point(2, 150.31, -33.7, null),
      point(3, 150.32, -33.7, 900),
    ]);
    // Neither leg has both ends, so nothing is counted — but the distance is.
    expect(stats.gainM).toBeNull();
    expect(stats.lossM).toBeNull();
    expect(stats.elevationComplete).toBe(false);
    expect(stats.distanceM).toBeGreaterThan(0);
  });
});

describe("nearestContourElevation", () => {
  const contour = (
    elev: number | string,
    coordinates: [number, number][],
  ): GeoJSON.Feature => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: { elev },
  });

  it("returns the elevation of the nearest contour vertex", () => {
    const features = [
      contour(700, [
        [150.3, -33.7],
        [150.301, -33.7],
      ]),
      contour(710, [
        [150.32, -33.7],
        [150.321, -33.7],
      ]),
    ];
    expect(nearestContourElevation(features, 150.3005, -33.7)).toBe(700);
    expect(nearestContourElevation(features, 150.3195, -33.7)).toBe(710);
  });

  it("accepts numeric-string elev and ignores features without one", () => {
    const features = [
      { ...contour(0, [[150.3, -33.7]]), properties: { name: "a track" } },
      contour("640", [[150.4, -33.7]]),
    ];
    expect(nearestContourElevation(features, 150.3, -33.7)).toBe(640);
  });

  it("returns null when nothing rendered under the tap carries a height", () => {
    expect(nearestContourElevation([], 150.3, -33.7)).toBeNull();
  });

  it("walks MultiLineString parts, which is how tiled contours arrive", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: [[[150.4, -33.7]], [[150.3001, -33.7]]],
      },
      properties: { elev: 660 },
    };
    expect(nearestContourElevation([feature], 150.3, -33.7)).toBe(660);
  });
});

describe("measureShape", () => {
  it("emits vertices only until there is a line to draw", () => {
    const one = measureShape([point(1, 150.3, -33.7)]);
    expect(one.features).toHaveLength(1);
    expect(one.features[0]!.geometry.type).toBe("Point");

    const two = measureShape([point(1, 150.3, -33.7), point(2, 150.31, -33.7)]);
    expect(two.features.map((f) => f.geometry.type)).toEqual([
      "LineString",
      "Point",
      "Point",
    ]);
  });
});
