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
import { clearDemTileCache } from "./demTileCache";

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

/** Saved clips of archive sources; empty unless a test fills it. */
const savedClips = vi.hoisted(() => [] as object[]);

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    getFirstAsync: async () => ({ tile_data }),
    closeAsync: async () => {},
  }),
}));
vi.mock("../config", () => ({
  config: { topoCdnBaseUrl: "https://cdn.test" },
}));
// A saved clip is read by byte range through expo-file-system; here the
// ranges come off the fixture archive on disk, so the phone's own file source
// (map/snapLines.ts) is the code under test.
vi.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  readAsStringAsync: async (
    uri: string,
    { position, length }: { position: number; length: number },
  ) =>
    readFileSync(uri.replace("file://", ""))
      .subarray(position, position + length)
      .toString("base64"),
}));
vi.mock("./localStores", () => ({ REGION_DIR: "file:///regions/" }));
vi.mock("./regionMbtiles", () => ({ regionFileName: (id: string) => id }));
vi.mock("./registryDb", () => ({
  listArtifacts: async () => [
    ...savedClips,
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

  // The archive half of the pair: shared/src/__fixtures__/dem-parity-nsw.json,
  // also read by the API's "falls through where it ends" case. The line starts
  // inside a saved clip of the NSW archive and leaves it, so the last two
  // heights come from the saved worldwide tile and the join is a seam.
  //
  // Mutation: look a saved clip up by anything but its source id, or read it
  // as MBTiles, and every height here comes from the worldwide tile.
  it("reads a saved clip of an archive source, and the seam where it ends", async () => {
    const nsw = JSON.parse(
      readFileSync(join(FIXTURES, "dem-parity-nsw.json"), "utf8"),
    ) as typeof parity & { levelled: number[] };
    savedClips.push({
      id: "clip",
      kind: "dem-region",
      logicalKey: "nsw-5m",
      format: "pmtiles",
      path: join(FIXTURES, "nsw-5m-z15-katoomba.pmtiles"),
    });
    clearDemTileCache();

    const dem = await sampleElevations(nsw.positions);
    expect(dem.sourceIds).toEqual(nsw.sourceIds);
    dem.heights.forEach((height, i) =>
      expect(height).toBeCloseTo(nsw.heights[i]!, 1),
    );
    dem.levelled.forEach((height, i) =>
      expect(height).toBeCloseTo(nsw.levelled[i]!, 1),
    );
  });
});
