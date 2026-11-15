import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  layerIn,
  MAP_TERRAIN,
  NSW_REGION,
  SIM_NZ,
  SIM_UTAH,
  SIM_WORLD,
  TERRAIN_LAYER_KEYS,
  type Region,
} from "@logjam/shared";
import {
  coverageCarrierHere,
  terrainSwitch as switchIn,
} from "./terrainSwitches";

// The cases below are over New South Wales, which has every layer.
const terrainSwitch = (
  key: Parameters<typeof switchIn>[0],
  stored: boolean,
  basemapId: Parameters<typeof switchIn>[2],
  online: boolean,
  artifacts: Parameters<typeof switchIn>[4],
  region: Region | null = NSW_REGION,
) => switchIn(key, stored, basemapId, online, artifacts, region);

const copy = MAP_TERRAIN.copy;
const clip = (
  kind: string,
  logicalKey: string,
  minzoom: number | null = 8,
) => ({
  kind: kind as never,
  logicalKey,
  minzoom,
});
const saved = [
  clip("contours-region", "nsw-contours"),
  clip("slope-region", "nsw-5m-slope"),
  clip("land-region", "nsw-land"),
  clip("fire-region", "nsw-fire"),
  clip("coverage-region", "nsw-coverage"),
  clip("dem-region", "nsw-5m"),
];

describe("terrainSwitch", () => {
  // Mutation: return `checked: stored` in the basemap cases, and a stored-on
  // contours switch reads ON, dimmed, over a sheet that prints its own.
  it("reads OFF while a basemap disables it, with the basemap's reason", () => {
    expect(terrainSwitch("contours", true, "six-topo", true, saved)).toEqual({
      checked: false,
      disabled: true,
      reason: copy.contoursPrinted,
    });
    expect(
      terrainSwitch("hillshade", true, "six-imagery", true, saved),
    ).toEqual({
      checked: false,
      disabled: true,
      reason: copy.hillshadeImagery,
    });
    // The stored choice comes back on a basemap that can draw it.
    expect(
      terrainSwitch("hillshade", true, "six-topo", true, saved).checked,
    ).toBe(true);
  });

  // Mutation: test `online` before the basemap, and imagery offline says
  // "Needs a connection" instead of the reason that still holds online.
  it("the basemap's reason outranks the connection's", () => {
    expect(
      terrainSwitch("hillshade", true, "six-imagery", false, []).reason,
    ).toBe(copy.hillshadeImagery);
  });

  // Mutation: drop the `saved` test for one key (slope or contours), and a
  // switch is on with nothing to draw, or off despite a saved clip.
  it("offline, every layer needs a saved clip of itself", () => {
    for (const key of TERRAIN_LAYER_KEYS) {
      const off = terrainSwitch(key, true, "protomaps", false, []);
      expect(off).toEqual({
        checked: true,
        disabled: true,
        reason: "Needs a connection",
      });
      expect(terrainSwitch(key, true, "protomaps", false, saved).disabled).toBe(
        false,
      );
      expect(terrainSwitch(key, true, "protomaps", true, []).disabled).toBe(
        false,
      );
    }
    // A clip of another layer, or the height clip saved at z15 alone, is none.
    expect(
      terrainSwitch("slope", true, "protomaps", false, [saved[0]!]).disabled,
    ).toBe(true);
    expect(
      terrainSwitch("hillshade", true, "protomaps", false, [
        clip("dem-region", "nsw-5m", 15),
      ]).disabled,
    ).toBe(true);
    expect(
      terrainSwitch("fire", true, "protomaps", false, [saved[2]!]).disabled,
    ).toBe(true);
    expect(
      terrainSwitch("coverage", true, "protomaps", false, [saved[3]!]).disabled,
    ).toBe(true);
  });
});

describe("terrainSwitch where the region lacks the layer", () => {
  // Mutation: drop the `layerIn(region, key) === null` test, and every switch
  // is live over a region with no archive for it, drawing nothing.
  it("reads OFF and disabled, saying so, for each layer the region lacks", () => {
    let lacking = 0;
    for (const key of TERRAIN_LAYER_KEYS) {
      const state = terrainSwitch(key, true, "protomaps", true, [], SIM_UTAH);
      if (layerIn(SIM_UTAH, key)) {
        expect(state, key).toEqual({ checked: true, disabled: false });
      } else {
        lacking += 1;
        expect(state, key).toEqual({
          checked: false,
          disabled: true,
          reason: copy.notHere,
        });
      }
    }
    // Utah has no coverage, so the loop met a layer it lacks and one it has.
    expect(lacking).toBe(1);
  });

  // Mutation: test the basemap or the connection before the region, and
  // contours over the world tier, which has none, read the reason of a sheet
  // that prints its own, or "Needs a connection".
  it("outranks the basemap's reason and the connection's", () => {
    const here = { checked: false, disabled: true, reason: copy.notHere };
    expect(
      terrainSwitch("contours", true, "six-topo", true, [], SIM_WORLD),
    ).toEqual(here);
    expect(
      terrainSwitch("contours", true, "protomaps", false, [], SIM_WORLD),
    ).toEqual(here);
    // The world tier has hillshade: that switch falls through to the rest.
    expect(
      terrainSwitch("hillshade", true, "protomaps", true, [], SIM_WORLD),
    ).toEqual({ checked: true, disabled: false });
  });

  // Mutation: read a null region as New South Wales, and the switches stay
  // live over open ocean.
  it("is not available over ground no region holds", () => {
    for (const key of TERRAIN_LAYER_KEYS) {
      expect(
        terrainSwitch(key, true, "protomaps", true, saved, null).reason,
      ).toBe(copy.notHere);
    }
  });

  // Mutation: keep a saved clip as a way round the reason, and an NSW clip
  // makes the switch live over a region the clip does not cover.
  it("is not lifted by a saved clip of the layer", () => {
    expect(
      terrainSwitch("contours", true, "protomaps", false, saved, SIM_WORLD)
        .reason,
    ).toBe(copy.notHere);
  });
});

describe("coverageCarrierHere", () => {
  // Mutation: return the stored carrier whatever the region lists, and the
  // Coverage row names a network the region in view has no data for.
  it("keeps a stored carrier only where the region lists it", () => {
    expect(coverageCarrierHere(NSW_REGION, "optus")).toBe("optus");
    expect(coverageCarrierHere(SIM_NZ, "optus")).toBeNull();
    expect(coverageCarrierHere(SIM_NZ, "simtwo")).toBe("simtwo");
    expect(coverageCarrierHere(SIM_UTAH, "simtwo")).toBeNull();
    expect(coverageCarrierHere(null, "optus")).toBeNull();
    expect(coverageCarrierHere(NSW_REGION, null)).toBeNull();
  });
});

describe("the map's Coverage layer", () => {
  const screen = readFileSync(
    new URL("./MapScreen.tsx", import.meta.url),
    "utf8",
  );

  // Mutation: pass the stored `coverageCarrier` to `drawsCoverage`,
  // `coverageLayerFilter` or `coverageAtTap`, and over a region that lists
  // other carriers the layer fetches tiles for a network the row says is not
  // chosen.
  it("draws, filters and answers a tap with the carrier that counts here", () => {
    expect(screen).toContain(
      "const carrierHere = coverageCarrierHere(terrainRegion, coverageCarrier);",
    );
    expect(screen).toContain(
      "drawsCoverage(terrainLayers.coverage, carrierHere)",
    );
    expect(screen).toContain(
      "coverageLayerFilter(coverageArchive, carrierHere)",
    );
    expect(screen).toMatch(
      /coverageLayerIdList,\s*carrierHere,\s*coverageArchive/,
    );
    expect(screen).not.toMatch(/coverageLayerFilter\([^)]*coverageCarrier\b/);
  });
});
