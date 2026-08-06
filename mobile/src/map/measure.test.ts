import { describe, it, expect } from "vitest";

import { measureShape, measureStats, type MeasurePoint } from "./measure";

function point(id: number, longitude: number, latitude: number): MeasurePoint {
  return { id, longitude, latitude };
}

describe("measureStats", () => {
  it("is empty for fewer than two points", () => {
    expect(measureStats([])).toEqual({ distanceM: 0 });
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
