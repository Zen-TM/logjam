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
const savedAreas = vi.hoisted(() => [] as object[]);
vi.mock("./sharpenedAreaStore", () => ({
  savedSharpenedAreas: async () => savedAreas,
}));

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

// A made-up area holding one flat z16 terrarium tile (RGB 128,128,128 decodes
// to 128.5 m) at the first point of dem-parity-nsw.json, where the statewide
// fixture reads ~980 m. The archive is written as api/prisma/seedArchives.ts
// `singleTilePmtiles` writes one, with an RGB tile in place of `flatPng`'s
// grey (Logjam GPS decodes RGB, as every sharpened archive is).
// Mutation: sample with DEM_SOURCES alone (not `demSourcesFor` the kept
// areas), and the point reads the statewide clip.
it("reads a saved clip of a sharpened area before the statewide one", async () => {
  savedAreas.push({
    id: "made-up",
    zmax: 16,
    tiles15: [30064, 19644, 30065, 19645],
    coverage: [150.29, -33.71, 150.33, -33.69],
    contours: false,
    credit: "Elevation: a made-up survey.",
    createdAt: "2026-10-01T00:00:00Z",
  });
  savedClips.push(
    {
      id: "area-clip",
      kind: "dem-region",
      logicalKey: "lidar-made-up",
      format: "pmtiles",
      path: join(FIXTURES, "sharpened-z16-flat.pmtiles"),
    },
    {
      id: "nsw-clip",
      kind: "dem-region",
      logicalKey: "nsw-5m",
      format: "pmtiles",
      path: join(FIXTURES, "nsw-5m-z15-katoomba.pmtiles"),
    },
  );
  clearDemTileCache();
  const dem = await sampleElevations([
    { lon: 150.3105, lat: -33.7005, distanceM: 0 },
  ]);
  expect(dem.sourceIds).toEqual(["lidar-made-up"]);
  expect(dem.heights[0]).toBeCloseTo(128.5, 1);
  savedAreas.length = 0;
});

// Mutation: clear only the tile cache on sign-out, and an archive opened on a
// saved clip outlives the user, with the saved area's bounds in its header.
it("drops every open archive when the offline cache is cleared", async () => {
  const { demArchive } = await import("@logjam/shared");
  const { clearOfflineDemCache } = await import("./demLookup");
  const opened = demArchive("https://cdn.test/held.pmtiles");
  expect(demArchive("https://cdn.test/held.pmtiles")).toBe(opened);
  clearOfflineDemCache();
  expect(demArchive("https://cdn.test/held.pmtiles")).not.toBe(opened);
});
