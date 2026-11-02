import { describe, expect, it } from "vitest";

import { toEastingNorthing } from "./geoPdfExtent.js";
import { mgaGrid, mgaGridLabel, mgaGridStep } from "./mgaGrid.js";

// Around Katoomba (zone 56).
const view = { west: 150.28, south: -33.74, east: 150.34, north: -33.7 };

describe("mgaGrid", () => {
  // Mutation: drop the min-zoom test and the grid builds at state zoom.
  it("is empty below the minimum zoom", () => {
    expect(mgaGridStep(8.9)).toBeNull();
    expect(mgaGrid(view, 8.9).lines.features).toHaveLength(0);
  });

  it("steps by zoom", () => {
    expect([10, 14, 17].map(mgaGridStep)).toEqual([10000, 1000, 100]);
  });

  // Mutation: build lines with two vertices and they cut straight across in
  // Web Mercator; also catches an easting line that is not at a whole step.
  it("draws densified lines on whole steps of the grid", () => {
    const g = mgaGrid(view, 14);
    expect(g.lines.features.length).toBeGreaterThan(8);
    const first = g.lines.features[0].geometry.coordinates;
    expect(first.length).toBeGreaterThan(2);
    const e = toEastingNorthing(first[0][1], first[0][0]).easting;
    expect(Math.abs(e / 1000 - Math.round(e / 1000))).toBeLessThan(1e-6);
  });

  // Mutation: change the line walk to `<` and an edge line disappears.
  it("keeps the line count bounded at every zoom", () => {
    // A 1000 px square view at each zoom.
    for (const z of [9, 12.9, 13, 15.9, 16, 20]) {
      const d = (360 * 1000) / (256 * 2 ** z) / 2;
      const v = {
        west: 150.3 - d,
        east: 150.3 + d,
        south: -33.7 - d * 0.83,
        north: -33.7 + d * 0.83,
      };
      expect(mgaGrid(v, z).lines.features.length).toBeLessThan(80);
    }
  });

  it("labels with the map-margin digits", () => {
    expect(mgaGridLabel(6284000, 1000)).toBe("84");
    expect(mgaGridLabel(6284300, 100)).toBe("843");
    expect(mgaGridLabel(250000, 10000)).toBe("50");
  });

  it("uses the zone of the view centre across a boundary", () => {
    const g = mgaGrid(
      { west: 149.9, south: -33.7, east: 150.1, north: -33.6 },
      11,
    );
    expect(g.lines.features.length).toBeGreaterThan(0);
  });
});
