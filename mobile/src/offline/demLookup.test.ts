// Half of the DEM parity pair; the other half is the "parity" case in
// api/src/services/elevation.unit.test.ts. Both readers are handed the same
// real tile and must give the heights and source ids in
// shared/src/__fixtures__/dem-parity.json, which were worked out by a third,
// independent decoder (Python PIL, blended by hand).
//
// Mutation: sample in this reader instead of through `sampleDem` (say, read
// the nearest pixel) and the heights drift from the API's by metres.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { sampleElevations } from "./demLookup";

const FIXTURES = join(__dirname, "../../../shared/src/__fixtures__");
const parity = JSON.parse(
  readFileSync(join(FIXTURES, "dem-parity.json"), "utf8"),
) as {
  positions: { lon: number; lat: number; distanceM: number }[];
  heights: number[];
  sourceIds: string[];
};
const tile_data = new Uint8Array(
  readFileSync(join(FIXTURES, "terrarium-z13-7516-4911.png")),
);

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    getFirstAsync: async () => ({ tile_data }),
    closeAsync: async () => {},
  }),
}));
vi.mock("./localStores", () => ({ REGION_DIR: "file:///regions/" }));
vi.mock("./regionMbtiles", () => ({ regionFileName: (id: string) => id }));
vi.mock("./registryDb", () => ({
  listArtifacts: async () => [
    { id: "saved", kind: "dem-region", logicalKey: "terrarium" },
    // Another source's file must not answer for this one.
    { id: "other", kind: "dem-region", logicalKey: "not-a-source" },
  ],
}));

describe("sampleElevations (saved tiles)", () => {
  it("reads the heights and source ids the API reads from the same tile", async () => {
    const dem = await sampleElevations(parity.positions);
    expect(dem.sourceIds).toEqual(parity.sourceIds);
    dem.heights.forEach((height, i) =>
      expect(height).toBeCloseTo(parity.heights[i]!, 2),
    );
  });
});
