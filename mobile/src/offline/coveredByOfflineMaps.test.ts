import { describe, expect, it } from "vitest";

import {
  coveredByOfflineMaps,
  routeCoveredByOfflineMaps,
} from "./coveredByOfflineMaps";

type Point = [lon: number, lat: number];
const region = (bbox: [number, number, number, number] | null) => ({
  kind: "basemap-region" as const,
  bbox,
});

describe("coveredByOfflineMaps", () => {
  const saved = [region([150, -34, 151, -33])];

  it("holds a box inside the region", () => {
    expect(coveredByOfflineMaps([150.2, -33.8, 150.3, -33.7], saved)).toBe(
      true,
    );
  });

  // Mutation: compare an edge with < instead of <=, or move one edge by a
  // step. A place on the region's very edge flips, and so does one a step out.
  it("counts the region's own edge as inside, and a step past it as outside", () => {
    expect(coveredByOfflineMaps([150, -34, 151, -33], saved)).toBe(true);
    expect(coveredByOfflineMaps([149.999, -34, 151, -33], saved)).toBe(false);
    expect(coveredByOfflineMaps([150, -34.001, 151, -33], saved)).toBe(false);
    expect(coveredByOfflineMaps([150, -34, 151.001, -33], saved)).toBe(false);
    expect(coveredByOfflineMaps([150, -34, 151, -32.999], saved)).toBe(false);
  });

  it("is not covered by a box that only overlaps", () => {
    expect(coveredByOfflineMaps([150.9, -33.5, 151.5, -33.4], saved)).toBe(
      false,
    );
  });

  it("ignores anything that is not a saved basemap region", () => {
    expect(
      coveredByOfflineMaps(
        [150.2, -33.8, 150.3, -33.7],
        [{ kind: "geopdf" as never, bbox: [150, -34, 151, -33] }, region(null)],
      ),
    ).toBe(false);
    expect(coveredByOfflineMaps([150.2, -33.8, 150.3, -33.7], [])).toBe(false);
  });
});

describe("coveredByOfflineMaps across regions", () => {
  const west = region([150, -34, 150.5, -33]);
  const east = region([150.5, -34, 151, -33]);

  // Mutation: drop the corners-and-centre branch, and a place on the seam of
  // two saved regions reads "No offline map".
  it("holds a frame that sits across two regions that meet", () => {
    expect(
      coveredByOfflineMaps([150.4, -33.6, 150.6, -33.4], [west, east]),
    ).toBe(true);
  });

  // Mutation: test the centre alone, and a frame whose far corner is off the
  // saved ground passes.
  it("does not hold a frame with a corner on no region", () => {
    expect(
      coveredByOfflineMaps([150.4, -33.6, 151.2, -33.4], [west, east]),
    ).toBe(false);
  });
});

describe("routeCoveredByOfflineMaps", () => {
  const west = region([150, -34, 150.5, -33]);
  const east = region([150.5, -34, 151, -33]);

  it("holds a way across two regions that meet", () => {
    expect(
      routeCoveredByOfflineMaps(
        [
          [150.1, -33.5],
          [150.9, -33.5],
        ],
        [west, east],
      ),
    ).toBe(true);
  });

  // Mutation: check the vertices only. This way's two ends are saved but the
  // ground between them, over a gap, is not.
  it("is not held when the ground between two saved ends is missing", () => {
    const left = region([150, -34, 150.2, -33]);
    const right = region([150.8, -34, 151, -33]);
    expect(
      routeCoveredByOfflineMaps(
        [
          [150.1, -33.5],
          [150.9, -33.5],
        ],
        [left, right],
      ),
    ).toBe(false);
  });

  it("is not held when one vertex is outside every region", () => {
    expect(
      routeCoveredByOfflineMaps(
        [
          [150.1, -33.5],
          [151.5, -33.5],
        ],
        [west, east],
      ),
    ).toBe(false);
  });

  it("holds nothing for a way with no points", () => {
    expect(routeCoveredByOfflineMaps([], [west])).toBe(false);
  });
});

describe("a saved region that runs past 180°", () => {
  // Made-up ground either side of the line.
  const across = region([178, -18, 182, -16]);

  // Mutation: compare plain in both `holds` (`region[0] <= lon && region[2] >=
  // lon`) and the whole-box test (`box[0] <= west && box[2] >= east`). The
  // -179.5 box reads uncovered.
  it("holds a place's box on either side of the line", () => {
    expect(coveredByOfflineMaps([179.4, -17.1, 179.6, -16.9], [across])).toBe(
      true,
    );
    expect(coveredByOfflineMaps([-179.6, -17.1, -179.4, -16.9], [across])).toBe(
      true,
    );
    expect(coveredByOfflineMaps([176.9, -17.1, 177.1, -16.9], [across])).toBe(
      false,
    );
  });

  // Mutation: the same direct comparison in `holds`; the -179.5 way reads uncovered.
  it("holds a way on either side of the line", () => {
    expect(
      routeCoveredByOfflineMaps(
        [
          [179.5, -17],
          [179.9, -17],
        ],
        [across],
      ),
    ).toBe(true);
    expect(
      routeCoveredByOfflineMaps(
        [
          [-179.5, -17],
          [-179.9, -17],
        ],
        [across],
      ),
    ).toBe(true);
    expect(
      routeCoveredByOfflineMaps(
        [
          [179.5, -17],
          [177, -17],
        ],
        [across],
      ),
    ).toBe(false);
  });

  // Mutation: in `routeCoveredByOfflineMaps`, take the leg's end as
  // `points[i][0]` and not `lonNear(points[i][0], lon0)`, and a way whose
  // consecutive vertices straddle 180 is walked the long way round, through
  // ground no region holds.
  it("holds a way whose consecutive vertices straddle the line", () => {
    const vertices: Point[] = [
      [179.9, -17],
      [-179.9, -17],
      [-179.5, -17.2],
    ];
    expect(routeCoveredByOfflineMaps(vertices, [across])).toBe(true);
    expect(routeCoveredByOfflineMaps([...vertices].reverse(), [across])).toBe(
      true,
    );
  });

  // Mutation: check only a leg's vertices in `routeCoveredByOfflineMaps` (set
  // `parts` to 1), and the hole at the line itself is stepped over.
  it("does not hold a way across the line where the ground between is missing", () => {
    const eastSide = region([178, -18, 179.99, -16]);
    const westSide = region([-179.99, -18, -178, -16]);
    expect(
      routeCoveredByOfflineMaps(
        [
          [179.9, -17],
          [-179.9, -17],
        ],
        [eastSide, westSide],
      ),
    ).toBe(false);
    expect(
      routeCoveredByOfflineMaps(
        [
          [179.5, -17],
          [179.9, -17],
        ],
        [eastSide, westSide],
      ),
    ).toBe(true);
  });

  // Mutation: in `coveredByOfflineMaps` compare the whole box as plain numbers
  // (`box[0] <= west && box[2] >= east`), and a box saved wrapped (west above
  // east) is held by any region west of it, 150 to 151 included.
  it("does not hold a box across the line over ground no region holds there", () => {
    const elsewhere = region([150, -18, 151, -16]);
    expect(
      coveredByOfflineMaps([179.4, -17.1, -179.4, -16.9], [elsewhere]),
    ).toBe(false);
    expect(
      coveredByOfflineMaps([179.4, -17.1, 180.6, -16.9], [elsewhere]),
    ).toBe(false);
    expect(
      coveredByOfflineMaps([539.4, -17.1, 540.6, -16.9], [elsewhere]),
    ).toBe(false);
  });

  // Mutation: take the centre sample as `(west + east) / 2` in
  // `coveredByOfflineMaps` (in place of `lonMid`), and a box saved wrapped, held by two regions that
  // meet at the line, has its centre at 0 and is not held.
  it("holds a box that two regions meeting at the line cover between them", () => {
    const eastSide = region([178, -18, 180, -16]);
    const westSide = region([-180, -18, -178, -16]);
    for (const box of [
      [179.4, -17.1, 180.6, -16.9],
      [179.4, -17.1, -179.4, -16.9],
    ] as const)
      expect(coveredByOfflineMaps([...box], [eastSide, westSide])).toBe(true);
  });
});
