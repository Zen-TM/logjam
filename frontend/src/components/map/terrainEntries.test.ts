import {
  NSW_REGION,
  TERRAIN_LAYER_KEYS,
  type SharpenedOverlay,
  SIM_NZ,
  SIM_UTAH,
  SIM_WORLD,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { terrainEntryId, terrainKeyOf } from "./layerOrder";
import { routedAttribution } from "./terrainRouter";
import { terrainEntries } from "./terrainEntries";

// A made-up area: z15 tiles 30100–30103 × 19654–19657, to z16, in NSW.
const area: SharpenedOverlay = {
  id: "a1",
  zmax: 16,
  tiles15: [30100, 19654, 30103, 19657],
  coverage: [150.7, -33.8, 150.72, -33.78],
  contours: true,
  credit: "Elevation: a survey <made up> & credited.",
  createdAt: "2026-10-24T00:00:00.000Z",
  heightsUrl: "https://bucket.test/h?sig",
  slopeUrl: "https://bucket.test/s?sig",
  contoursUrl: "https://bucket.test/c?sig",
};

const origin = window.location.origin;

describe("terrainEntries", () => {
  // Mutation: read NSW's archives whatever the region, and a map over another
  // region draws NSW's tiles from its own source.
  it("reads each layer from the region's own archive", () => {
    for (const region of [NSW_REGION, SIM_NZ]) {
      const entries = terrainEntries(region, []);
      for (const key of [
        "contours",
        "slope",
        "land",
        "fire",
        "coverage",
      ] as const)
        expect(entries[key]?.pmtilesUrl).toBe(
          `${origin}/${region.terrain[key]!.archivePath}`,
        );
      expect(entries.hillshade?.pmtilesUrl).toBe(
        `${origin}/${region.terrain.heights!.archivePath}`,
      );
    }
  });

  // Mutation: keep an entry for a layer the region lacks, or draw a group over
  // no region, and the map adds a source whose archive does not exist (its
  // failure toasts "map file is missing").
  it("has no entry for a layer the region lacks, and none over no region", () => {
    expect(Object.keys(terrainEntries(SIM_UTAH, [])).sort()).toEqual([
      "contours",
      "fire",
      "hillshade",
      "land",
      "slope",
    ]);
    expect(Object.keys(terrainEntries(SIM_WORLD, []))).toEqual(["hillshade"]);
    expect(terrainEntries(null, [area])).toEqual({});
  });

  // Mutation: build an entry's id from anything but `terrainEntryId`, or put a
  // dash in it, and Map.tsx cannot tell which layer a source is, or splits the
  // id at the dash into the wrong layers.
  it("names each entry so its layer is read back from the id", () => {
    for (const region of [NSW_REGION, SIM_NZ, SIM_UTAH]) {
      const entries = terrainEntries(region, [area]);
      for (const key of TERRAIN_LAYER_KEYS) {
        const entry = entries[key];
        if (!entry) continue;
        expect(entry.id).toBe(terrainEntryId(region, key));
        expect(entry.id).not.toContain("-");
        expect(terrainKeyOf(entry.id)).toBe(key);
      }
    }
  });

  // Mutation: share one id across regions, and crossing into another region
  // keeps the first region's source under the second's layers.
  it("gives a region's entries ids no other region's has", () => {
    const ids = [NSW_REGION, SIM_NZ, SIM_UTAH].flatMap((region) =>
      Object.values(terrainEntries(region, [])).map((entry) => entry.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Mutation: route every user's terrain, and a user with no area reads
  // every Terrain tile through the router for nothing.
  it("reads no tile through the router for a user with no area", () => {
    for (const entry of Object.values(terrainEntries(NSW_REGION, [])))
      expect(entry.tiles).toBeUndefined();
  });

  // Mutations: a routed source that stops at z15 (the area's z16 is never
  // asked for), contours past z14, or the survey's credit left out.
  it("routes each layer to the deepest zoom an area holds, crediting it", () => {
    const entries = terrainEntries(NSW_REGION, [
      area,
      { ...area, id: "a2", zmax: 17 },
    ]);
    expect(entries.slope?.tiles).toMatchObject({ minzoom: 8, maxzoom: 17 });
    expect(entries.hillshade?.tiles?.maxzoom).toBe(17);
    expect(entries.contours?.tiles).toMatchObject({ minzoom: 11, maxzoom: 14 });
    expect(entries.slope?.id).toBe(terrainEntryId(NSW_REGION, "slope"));
    expect(entries.slope?.attribution).toContain(
      "a survey &lt;made up&gt; &amp; credited.",
    );
    expect(entries.slope?.tiles?.bounds).toEqual(
      NSW_REGION.terrain.heights!.coverage,
    );
  });

  // Mutation: route a layer an area does not replace (Land, Fire history,
  // Coverage), and an overlay is read through the router for nothing.
  it("leaves the overlays as they are over an area", () => {
    const entries = terrainEntries(NSW_REGION, [area]);
    for (const key of ["land", "fire", "coverage"] as const)
      expect(entries[key]).toEqual(terrainEntries(NSW_REGION, [])[key]);
  });

  // Mutation: pass every area on to `routed` (drop the `areasIn` filter), and
  // an area in NSW turns another region's terrain into routed sources whose
  // zooms reach past its archives.
  it("ignores an area another region holds", () => {
    expect(terrainEntries(SIM_NZ, [area])).toEqual(terrainEntries(SIM_NZ, []));
  });
});

describe("routedAttribution", () => {
  // Mutation: one line per area, and two areas from the same month credit
  // the survey twice under every Terrain layer.
  it("credits each line once, for every visible area", () => {
    const other = { ...area, id: "a2", credit: "Elevation: another survey." };
    const credit = routedAttribution("Statewide.", [
      area,
      { ...area, id: "a3" },
      other,
    ]);
    expect(credit.split("credited.").length - 1).toBe(1);
    expect(credit).toContain("another survey.");
  });
});
