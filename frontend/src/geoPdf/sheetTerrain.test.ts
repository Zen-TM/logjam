// @vitest-environment node
import {
  layerIn,
  NSW_REGION,
  SIM_NZ,
  SIM_REGIONS,
  SIM_UTAH,
  SIM_WORLD,
  type Region,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { sheetTerrain } from "./sheetTerrain";

// Made-up boxes: one near Katoomba (NSW), one inside the first simulated
// New Zealand box, one inside simulated Utah's, one in the open ocean.
const KATOOMBA = { north: -33.7, south: -33.76, east: 150.36, west: 150.3 };
const NZ = { north: -44.6, south: -44.65, east: 169.1, west: 169.05 };
const UTAH = { north: 38.3, south: 38.25, east: -110.75, west: -110.8 };
const OCEAN = { north: -10, south: -10.1, east: -140, west: -140.1 };
const ALL = [NSW_REGION, ...SIM_REGIONS];

describe("sheetTerrain", () => {
  // Mutation: take `regions[0]` in sheetTerrain in place of the region
  // `regionInView` picks, and a sheet in another region reads NSW's archives.
  it("is the archives of the region the sheet is in", () => {
    const nsw = sheetTerrain(KATOOMBA, ALL);
    expect(nsw.heights).toBe(NSW_REGION.terrain.hillshade);
    expect(nsw.slope).toBe(NSW_REGION.terrain.slope);
    expect(nsw.contours).toBe(NSW_REGION.terrain.contours);
    expect(nsw.land).toBe(NSW_REGION.terrain.land);
    expect(nsw.credit).toBe(NSW_REGION.terrain.heights.credit);

    const nz = sheetTerrain(NZ, ALL);
    expect(nz.heights).toBe(SIM_NZ.terrain.hillshade);
    expect(nz.slope).toBe(SIM_NZ.terrain.slope);
    expect(nz.contours).toBe(SIM_NZ.terrain.contours);
    expect(nz.land).toBe(SIM_NZ.terrain.land);
    expect(nz.credit).toBe(SIM_NZ.terrain.heights!.credit);
    expect(nz.credit).not.toBe(nsw.credit);
  });

  // Mutation: add `?? regions[0]` after `regionInView` in sheetTerrain, and a
  // print over the ocean asks for NSW's archives.
  it("has nothing where no region holds the sheet and the world declares nothing", () => {
    const none = sheetTerrain(OCEAN, ALL);
    expect(none).toEqual({
      heights: null,
      slope: null,
      contours: null,
      land: null,
      credit: null,
    });
  });

  // Mutation: drop the `world` argument from the `regionInView` call in
  // sheetTerrain, and a sheet in no region never reads the world's archives,
  // which a planet-wide build declares.
  it("falls to the world's archives where it declares some", () => {
    const world = sheetTerrain(OCEAN, ALL, SIM_WORLD);
    expect(world.heights).toBe(SIM_WORLD.terrain.hillshade);
    expect(world.heights).not.toBeNull();
    expect(world.slope).toBeNull();
  });

  // Mutation: add `?? regions[0]?.terrain.contours` to the contours member in
  // sheetTerrain, and a region without a layer inherits the first region's.
  it("has no archive for a layer its region lacks", () => {
    const bare: Region = {
      ...SIM_UTAH,
      terrain: { ...SIM_UTAH.terrain, contours: undefined },
    };
    const sheet = sheetTerrain(UTAH, [NSW_REGION, bare]);
    expect(sheet.contours).toBeNull();
    expect(sheet.slope).toBe(SIM_UTAH.terrain.slope);
  });
});

describe("a region that draws derived layers", () => {
  // Mutation: delete `heights` from a simulated region that declares slope.
  // A print credits the heights its derived layers are cut from, so a region
  // with one declares the other (terrainCreditLines draws no line for null).
  it("declares the heights whose credit a print carries", () => {
    let checked = 0;
    for (const region of [...ALL, SIM_WORLD]) {
      const derived = (["slope", "hillshade", "contours"] as const).filter(
        (key) => layerIn(region, key) !== null,
      );
      if (derived.length === 0) continue;
      expect(layerIn(region, "heights"), region.id).not.toBeNull();
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});
