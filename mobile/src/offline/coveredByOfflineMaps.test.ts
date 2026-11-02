import { describe, expect, it } from "vitest";

import {
  coveredByOfflineMaps,
  routeCoveredByOfflineMaps,
} from "./coveredByOfflineMaps";

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
