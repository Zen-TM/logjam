import { describe, it, expect } from "vitest";

import { routeArrows } from "./routeArrows";
import type { RoutePoint } from "@logjam/shared";

// Synthetic coordinates only.
const STRAIGHT_EAST: RoutePoint[] = [
  [150.0, -33.5],
  [150.01, -33.5],
];

describe("routeArrows", () => {
  it("spaces arrows evenly and never on an endpoint", () => {
    const arrows = routeArrows(STRAIGHT_EAST, 3);
    expect(arrows).toHaveLength(3);
    const lons = arrows.map((a) => a.coordinate[0]);
    expect(lons[0]).toBeGreaterThan(150.0);
    expect(lons[2]).toBeLessThan(150.01);
    // Even quarters of the span.
    expect(lons[1]! - lons[0]!).toBeCloseTo(lons[2]! - lons[1]!, 6);
  });

  it("points along the line, not at it", () => {
    // Due east is 90 degrees.
    expect(routeArrows(STRAIGHT_EAST, 1)[0]!.bearing).toBeCloseTo(90, 1);
  });

  it("spaces by DISTANCE, so a dense bend doesn't hoard the arrows", () => {
    // Twenty vertices in the first 1%, then one long run — vertex-based
    // spacing would put every arrow in the bend.
    const dense: RoutePoint[] = [
      ...Array.from({ length: 20 }, (_, i): RoutePoint => [150 + i * 0.00005, -33.5]),
      [150.05, -33.5],
    ];
    const arrows = routeArrows(dense, 3);
    expect(arrows.every((a) => a.coordinate[0] > 150.001)).toBe(true);
  });

  it("is empty for a line with no length or too few points", () => {
    expect(routeArrows([[150, -33.5]], 3)).toEqual([]);
    expect(routeArrows([[150, -33.5], [150, -33.5]], 3)).toEqual([]);
  });
});
