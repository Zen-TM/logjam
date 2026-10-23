import { describe, expect, it } from "vitest";
import { TERRAIN_LAYER_DEFAULTS } from "@logjam/shared";
import {
  contoursPrintedHere,
  LIDAR_ONLY_OVERLAYS,
  seedOverlays,
} from "./geoPdfOverlays";

describe("seedOverlays", () => {
  // Mutation: seed every Terrain layer on, as every overlay was before, and
  // a map showing contours alone prints slope and shading over the sheet.
  it("opens on the Terrain layers the map shows, and every LiDAR-only one", () => {
    const seeded = seedOverlays({
      ...TERRAIN_LAYER_DEFAULTS,
      contours: true,
      slope: false,
      hillshade: true,
    });
    expect(seeded.has("contours")).toBe(true);
    expect(seeded.has("slope")).toBe(false);
    expect(seeded.has("hillshade")).toBe(true);
    for (const layer of LIDAR_ONLY_OVERLAYS)
      expect(seeded.has(layer.name)).toBe(true);
  });

  it("leaves no Terrain layer among the LiDAR-only ones", () => {
    expect(LIDAR_ONLY_OVERLAYS.map((layer) => layer.name)).toEqual([
      "vegetation",
      "features",
    ]);
  });
});

describe("contoursPrintedHere", () => {
  // Mutation: ignore the LiDAR overlap, and a job's own contours over the
  // topographic sheet can no longer be ticked.
  it("is true only over a sheet that prints its own, with no job in the area", () => {
    expect(contoursPrintedHere("six-topo", false)).toBe(true);
    expect(contoursPrintedHere("six-topo", true)).toBe(false);
    expect(contoursPrintedHere("six-imagery", false)).toBe(false);
  });
});
