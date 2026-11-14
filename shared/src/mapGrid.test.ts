import { describe, expect, it } from "vitest";

import { gridZoneAt, mgaZone, toGrid, toGridAt } from "./grids.js";
import { clipToLongitudes, mapGrid, gridLabel, gridStep } from "./mapGrid.js";
import { SIM_REGIONS } from "./simRegions.js";

// Around Katoomba (zone 56).
const view = { west: 150.28, south: -33.74, east: 150.34, north: -33.7 };

describe("mapGrid", () => {
  // Mutation: drop the min-zoom test and the grid builds at state zoom.
  it("is empty below the minimum zoom", () => {
    expect(gridStep(8.9)).toBeNull();
    expect(mapGrid(view, 8.9).features).toHaveLength(0);
  });

  it("steps by zoom", () => {
    expect([10, 14, 17].map(gridStep)).toEqual([10000, 1000, 100]);
  });

  // Mutation: build lines with two vertices and they cut straight across in
  // Web Mercator; also catches an easting line that is not at a whole step.
  it("draws densified lines on whole steps of the grid", () => {
    const g = mapGrid(view, 14);
    expect(g.features.length).toBeGreaterThan(8);
    const first = g.features[0].geometry.coordinates;
    expect(first.length).toBeGreaterThan(2);
    const e = toGridAt(first[0][1], first[0][0]).easting;
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
      expect(mapGrid(v, z).features.length).toBeLessThan(80);
    }
  });

  // The overlay draws the grid of the ground at the view's centre, which is
  // UTM outside NSW. A northern view tells UTM from MGA: MGA's zone 54 there
  // is south of the equator on another meridian. Mutation: always build NSW's
  // MGA zones and no line sits on a whole kilometre of UTM 12.
  it("draws UTM lines for a view centred outside NSW", () => {
    // Around Bryce Canyon, Utah (UTM 12 north).
    const utah = { west: -112.2, south: 37.58, east: -112.14, north: 37.62 };
    const g = mapGrid(utah, 14);
    expect(g.features.length).toBeGreaterThan(8);
    for (const f of g.features) {
      const [lon, lat] = f.geometry.coordinates[0];
      const { easting, northing, zone } = toGridAt(lat, lon);
      expect(zone.name).toBe("UTM 12");
      const offStep = (m: number) => Math.abs(m / 1e3 - Math.round(m / 1e3));
      expect(Math.min(offStep(easting), offStep(northing))).toBeLessThan(1e-3);
    }
  });

  // Mutation: drop the copy shift in `mapGrid`'s `at` and lines come back in
  // [-180, 180], outside the view and its clip.
  it("draws a UTM view in another world copy where the view is", () => {
    const utah = { west: -112.2, south: 37.58, east: -112.14, north: 37.62 };
    const copy = { ...utah, west: utah.west - 720, east: utah.east - 720 };
    const g = mapGrid(copy, 14);
    expect(g.features.length).toBe(mapGrid(utah, 14).features.length);
    for (const f of g.features)
      for (const [lon] of f.geometry.coordinates)
        expect(lon).toBeLessThan(copy.east + 0.05);
  });

  // Mutation: filter the zones against the unshifted view and a view in
  // another world copy has no lines, or lines cut at the wrong meridian.
  it("cuts a view in another world copy at that copy's zone edge", () => {
    const edge = 150 - 360;
    const g = mapGrid(
      { west: edge - 0.1, south: -33.7, east: edge + 0.1, north: -33.6 },
      11,
    );
    expect(g.features.length).toBeGreaterThanOrEqual(2);
    const west = g.features.filter((f) =>
      f.geometry.coordinates.every(([lon]) => lon <= edge),
    );
    const east = g.features.filter((f) =>
      f.geometry.coordinates.every(([lon]) => lon >= edge),
    );
    expect(west.length).toBeGreaterThan(0);
    expect(east.length).toBeGreaterThan(0);
    expect(west.length + east.length).toBeGreaterThanOrEqual(g.features.length);
  });

  it("labels with the map-margin digits", () => {
    expect(gridLabel(6284000, 1000)).toBe("84");
    expect(gridLabel(6284300, 100)).toBe("843");
    expect(gridLabel(250000, 10000)).toBe("50");
  });

  // A northern zone's northing is negative south of the equator, and a margin
  // prints no sign. Mutation: revert to the sign-keeping `%`, and -30 000 m
  // reads "-30".
  it("labels a negative northing with unsigned margin digits", () => {
    expect(gridLabel(-30000, 10000)).toBe("70");
    expect(gridLabel(-1000, 1000)).toBe("99");
    expect(gridLabel(-300, 100)).toBe("997");
    expect(gridLabel(-30000, 1000)).toBe("70");
  });

  // Mutation: the same `%` revert, and a line south of the equator has "-1".
  it("labels every line of a view across the equator without a sign", () => {
    const g = mapGrid({ west: 12, south: -0.05, east: 12.05, north: 0.05 }, 14);
    expect(g.features.length).toBeGreaterThan(8);
    for (const f of g.features) expect(f.properties.text).toMatch(/^\d\d$/);
  });

  // Mutation: drop `text` from a line and the symbol layer drawing labels
  // along the lines has nothing to draw.
  it("carries each line's label on the line", () => {
    const g = mapGrid(view, 14);
    for (const f of g.features) expect(f.properties.text).toMatch(/^\d\d$/);
  });

  // Mutation: build only the centre's zone and the far side of the edge has
  // no lines of its own zone; drop the clip and the west zone's lines run
  // past the edge; move an edge or drop a zone in grids.ts MGA_ZONES.
  it.each([
    [144, 54, 55],
    [150, 55, 56],
  ] as const)("draws each zone's own grid either side of %i", (edge, w, e) => {
    const g = mapGrid(
      { west: edge - 0.1, south: -33.7, east: edge + 0.1, north: -33.6 },
      11,
    );
    const sides = new Set<number>();
    for (const f of g.features) {
      const c = f.geometry.coordinates;
      const zone = c.every(([lon]) => lon <= edge) ? w : e;
      expect(c.every(([lon]) => (zone === w ? lon <= edge : lon >= edge))).toBe(
        true,
      );
      sides.add(zone);
      const [lon, lat] = c[Math.floor(c.length / 2)];
      const { easting, northing } = toGrid(lat, lon, mgaZone(zone));
      const offStep = (m: number) => Math.abs(m / 1e4 - Math.round(m / 1e4));
      expect(Math.min(offStep(easting), offStep(northing))).toBeLessThan(1e-3);
    }
    expect([...sides].sort()).toEqual([w, e]);
  });

  // Mutation: interpolate at the midpoint, always cut at the east edge, or
  // keep a line that leaves and re-enters as one piece.
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
    expect(
      clipToLongitudes(
        [
          [153, 0],
          [149, 4],
          [148, 5],
          [151, 8],
        ],
        150,
        Infinity,
      ),
    ).toEqual([
      [
        [153, 0],
        [150, 3],
      ],
      [
        [150, 7],
        [151, 8],
      ],
    ]);
  });
});

// What NSW's overlay drew before there was a second region, taken from that
// code: with only NSW declared, a view over the zone 55/56 edge keeps these
// labels, vertex counts and end points. Mutation: draw the lines with any other
// grid for NSW (UTM's 6-degree zones put the 150 edge elsewhere), change a
// label, or drop the clip at the edge, and this goes red.
describe("with only New South Wales", () => {
  it("draws exactly the lines and labels it always drew", () => {
    const g = mapGrid(
      { west: 149.9, south: -33.7, east: 150.1, north: -33.6 },
      11,
    );
    expect(
      g.features.map((f) => {
        const c = f.geometry.coordinates;
        return [f.properties.text, c.length, c[0], c[c.length - 1]].map((v) =>
          Array.isArray(v) ? v.map((x: number) => +x.toFixed(5)) : v,
        );
      }),
    ).toEqual([
      ["70", 9, [149.91311, -33.70208], [149.90966, -33.59977]],
      ["70", 9, [149.89919, -33.67595], [150, -33.67354]],
      ["30", 9, [150.08689, -33.70208], [150.09034, -33.59977]],
      ["70", 9, [150, -33.67354], [150.10081, -33.67595]],
    ]);
  });
});

describe("the grid of the region the view is in", () => {
  // Wanaka, in the simulated New Zealand's south island.
  const nz = { west: 169.05, south: -44.66, east: 169.15, north: -44.6 };
  const offKm = (m: number) => Math.abs(m / 1e3 - Math.round(m / 1e3));

  // Mutation: ignore the `regions` argument (pass nothing on to
  // gridZonesFor) and the view gets UTM 59's lines, which sit off NZTM's
  // whole kilometres.
  it("draws NZTM lines over a simulated New Zealand", () => {
    const g = mapGrid(nz, 14, SIM_REGIONS);
    expect(g.features.length).toBeGreaterThan(8);
    const zone = gridZoneAt(169.1, -44.63, SIM_REGIONS);
    expect(zone.name).toBe("NZTM");
    for (const f of g.features) {
      const [lon, lat] = f.geometry.coordinates[0];
      const { easting, northing } = toGrid(lat, lon, zone);
      expect(Math.min(offKm(easting), offKm(northing))).toBeLessThan(1e-3);
    }
  });
});
