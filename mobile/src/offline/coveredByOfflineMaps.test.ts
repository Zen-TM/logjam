import { describe, expect, it } from "vitest";

import { coveredByOfflineMaps } from "./coveredByOfflineMaps";

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
