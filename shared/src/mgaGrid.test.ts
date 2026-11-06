import { describe, expect, it } from "vitest";

import { toEastingNorthing, toZoneEastingNorthing } from "./geoPdfExtent.js";
import {
  clipToLongitudes,
  mgaGrid,
  mgaGridLabel,
  mgaGridStep,
} from "./mgaGrid.js";

// Around Katoomba (zone 56).
const view = { west: 150.28, south: -33.74, east: 150.34, north: -33.7 };

describe("mgaGrid", () => {
  // Mutation: drop the min-zoom test and the grid builds at state zoom.
  it("is empty below the minimum zoom", () => {
    expect(mgaGridStep(8.9)).toBeNull();
    expect(mgaGrid(view, 8.9).features).toHaveLength(0);
  });

  it("steps by zoom", () => {
    expect([10, 14, 17].map(mgaGridStep)).toEqual([10000, 1000, 100]);
  });

  // Mutation: build lines with two vertices and they cut straight across in
  // Web Mercator; also catches an easting line that is not at a whole step.
  it("draws densified lines on whole steps of the grid", () => {
    const g = mgaGrid(view, 14);
    expect(g.features.length).toBeGreaterThan(8);
    const first = g.features[0].geometry.coordinates;
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
      expect(mgaGrid(v, z).features.length).toBeLessThan(80);
    }
  });

  it("labels with the map-margin digits", () => {
    expect(mgaGridLabel(6284000, 1000)).toBe("84");
    expect(mgaGridLabel(6284300, 100)).toBe("843");
    expect(mgaGridLabel(250000, 10000)).toBe("50");
  });

  // Mutation: drop `text` from a line and the symbol layer drawing labels
  // along the lines has nothing to draw.
  it("carries each line's label on the line", () => {
    const g = mgaGrid(view, 14);
    for (const f of g.features) expect(f.properties.text).toMatch(/^\d\d$/);
  });

  // Mutation: build only the centre's zone and the far side of 150 degrees
  // has no zone 56 lines; drop the clip and zone 55 lines run past 150.
  it("draws each zone's own grid on its side of a zone edge", () => {
    const g = mgaGrid(
      { west: 149.9, south: -33.7, east: 150.1, north: -33.6 },
      11,
    );
    const sides = new Set<number>();
    for (const f of g.features) {
      const c = f.geometry.coordinates;
      const zone = c.every(([lon]) => lon <= 150) ? 55 : 56;
      expect(c.every(([lon]) => (zone === 55 ? lon <= 150 : lon >= 150))).toBe(
        true,
      );
      sides.add(zone);
      const [lon, lat] = c[Math.floor(c.length / 2)];
      const { easting, northing } = toZoneEastingNorthing(lat, lon, zone);
      const offStep = (m: number) => Math.abs(m / 1e4 - Math.round(m / 1e4));
      expect(Math.min(offStep(easting), offStep(northing))).toBeLessThan(1e-3);
    }
    expect([...sides].sort()).toEqual([55, 56]);
  });

  it("cuts a line exactly at the edge longitude", () => {
    expect(
      clipToLongitudes(
        [
          [149, 0],
          [151, 2],
          [152, 3],
        ],
        -Infinity,
        150,
      ),
    ).toEqual([
      [
        [149, 0],
        [150, 1],
      ],
    ]);
  });
});
