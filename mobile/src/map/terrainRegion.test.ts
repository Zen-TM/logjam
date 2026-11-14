import { describe, expect, it } from "vitest";

import { NSW_REGION, SIM_NZ, SIM_REGIONS, SIM_WORLD } from "@logjam/shared";

import { regionShown } from "./terrainRegion";

const CAMERA = { latitude: 0, longitude: 0 };
const regions = [NSW_REGION, ...SIM_REGIONS];
const around = (lon: number, lat: number, half = 0.1) => ({
  west: lon - half,
  east: lon + half,
  south: lat - half,
  north: lat + half,
});

describe("regionShown", () => {
  // Mutation: read `NSW_REGION` in place of `regionInView`, and the Terrain
  // group draws New South Wales's archives over any other region.
  it("is the region under the centre of what is on screen", () => {
    expect(regionShown(around(150.3, -33.7), CAMERA, regions)).toBe(NSW_REGION);
    expect(regionShown(around(169.1, -44.6), CAMERA, regions)).toBe(SIM_NZ);
  });

  // Mutation: drop `wrapView`, and a map panned a turn round the world (its
  // longitudes past 180) is over no region.
  it("reads a view panned past the antimeridian by whole turns", () => {
    expect(regionShown(around(150.3 + 360, -33.7), CAMERA, regions)).toBe(
      NSW_REGION,
    );
  });

  // Mutation: return null for a null viewport, and the Terrain group is
  // blank until the map first settles.
  it("stands the camera's point in before the first settle", () => {
    expect(
      regionShown(null, { latitude: -44.6, longitude: 169.1 }, regions),
    ).toBe(SIM_NZ);
  });

  // Mutation: fall back to the first region, and the map over open ocean
  // draws New South Wales's layers.
  it("is none over ground no region covers, and the world where one is declared", () => {
    const sea = around(-30, 0);
    expect(regionShown(sea, CAMERA, regions)).toBeNull();
    expect(regionShown(sea, CAMERA, regions, SIM_WORLD)).toBe(SIM_WORLD);
  });
});
