import { describe, expect, it } from "vitest";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { vegetationUrlsFor } from "./geoPdfVegetation";

const extent = { north: -33.6, south: -33.7, east: 150.3, west: 150.2 };
const square = (w: number, s: number, e: number, n: number) => ({
  type: "Polygon" as const,
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});
const job = (
  id: string,
  createdAt: string,
  over: Partial<CompletedTopoJob> = {},
): CompletedTopoJob => ({
  jobId: id,
  syncRole: "owner",
  name: null,
  createdAt,
  footprint: square(150.21, -33.69, 150.29, -33.61),
  layers: [
    { name: "vegetation", format: "raster", pmtilesUrl: `https://v/${id}` },
  ],
  ...over,
});

describe("vegetationUrlsFor", () => {
  it("takes own overlapping jobs, oldest first", () => {
    expect(
      vegetationUrlsFor(
        [job("new", "2026-02-01"), job("old", "2026-01-01")],
        extent,
      ),
    ).toEqual(["https://v/old", "https://v/new"]);
  });

  // Mutation: drop the syncRole filter, and a shared job's vegetation is drawn.
  it("never draws a job shared with the user", () => {
    expect(
      vegetationUrlsFor(
        [job("theirs", "2026-01-01", { syncRole: "shared" })],
        extent,
      ),
    ).toEqual([]);
  });

  // Mutation: return true for every footprint, or none lacking one.
  it("skips a job away from the extent, keeps one with no footprint", () => {
    expect(
      vegetationUrlsFor(
        [
          job("far", "2026-01-01", {
            footprint: square(151, -34, 151.1, -33.9),
          }),
          job("bare", "2026-01-02", { footprint: null }),
        ],
        extent,
      ),
    ).toEqual(["https://v/bare"]);
  });
});
