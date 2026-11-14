// @vitest-environment node
import {
  layerIn,
  NSW_REGION,
  REGIONS,
  regionBounds,
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
  // `regionInWrappedView` picks, and a sheet in another region reads NSW's archives.
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

  // Mutation: call `regionInView` in place of `regionInWrappedView` in
  // sheetTerrain, and a sheet picked in another world copy (longitude shifted
  // by a whole turn) finds no region, so the dialog disables every layer.
  it("finds the region of a sheet picked in another world copy", () => {
    const turn = (box: typeof KATOOMBA, by: number) => ({
      ...box,
      west: box.west + by,
      east: box.east + by,
    });
    for (const by of [360, -360, 720]) {
      const sheet = sheetTerrain(turn(KATOOMBA, by), ALL);
      expect(sheet.heights, `${by}`).toBe(NSW_REGION.terrain.hillshade);
      expect(sheet.credit, `${by}`).toBe(NSW_REGION.terrain.heights.credit);
    }
  });

  // Mutation: take `regionsTouching(extent, regions)[0]` in sheetTerrain in
  // place of `regionInWrappedView`, and a sheet whose centre is in one region
  // but that touches an earlier one reads that earlier region's archives.
  it("takes all its Terrain from the one region at its centre, though another touches the sheet", () => {
    const square = (west: number, east: number) =>
      [
        [west, -1],
        [east, -1],
        [east, 1],
        [west, 1],
      ] as const;
    const west: Region = { ...SIM_NZ, borders: [square(0, 10)] };
    const east: Region = { ...SIM_UTAH, borders: [square(10, 20)] };
    // Centre 11: inside `east`; the box also reaches into `west`, listed first.
    const straddling = { north: 0.5, south: -0.5, west: 8, east: 14 };
    const sheet = sheetTerrain(straddling, [west, east]);
    expect(sheet.heights).toBe(SIM_UTAH.terrain.hillshade);
    expect(sheet.slope).toBe(SIM_UTAH.terrain.slope);
    expect(sheet.contours).toBe(SIM_UTAH.terrain.contours);
    expect(sheet.land).toBe(SIM_UTAH.terrain.land);
    expect(sheet.credit).toBe(SIM_UTAH.terrain.heights!.credit);
  });

  // Mutation: add `?? regions[0]` after `regionInWrappedView` in sheetTerrain, and a
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

  // Mutation: drop the `world` argument from the `regionInWrappedView` call in
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
  // Mutation: delete `heights` from a simulated region that declares slope, or
  // start a region's heights credit with something other than "Elevation".
  // A print credits the heights its derived layers are cut from, worded by
  // replacing that leading word (`terrainCredit`), so every region declares
  // them, with a credit that starts with it.
  it("declares the heights whose credit a print carries", () => {
    const every = [...new Set([...REGIONS, ...ALL])];
    let checked = 0;
    for (const region of [...every, SIM_WORLD]) {
      const derived = (["slope", "hillshade", "contours"] as const).filter(
        (key) => layerIn(region, key) !== null,
      );
      if (derived.length === 0) continue;
      const heights = layerIn(region, "heights");
      expect(heights, region.id).not.toBeNull();
      expect(heights!.credit, region.id).toMatch(/^Elevation/);
      // The sheet inside the region carries exactly that credit.
      const box =
        region.borders.length > 0
          ? regionBounds(region)
          : { west: 0, south: 0, east: 1, north: 1 };
      const sheet =
        region.borders.length > 0
          ? sheetTerrain(box, [region])
          : sheetTerrain(box, [], region);
      expect(sheet.credit, region.id).toBe(heights!.credit);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});
