import { describe, expect, it } from "vitest";
import { MAP_TERRAIN, TERRAIN_LAYER_KEYS } from "@logjam/shared";

import {
  TERRAIN_UNAVAILABLE_MESSAGE,
  VEGETATION_UNAVAILABLE_MESSAGE,
} from "./terrainUnavailable";

// Whole messages keep their sentence whole for a translator, so nothing builds
// them from the layer's name; this holds that each still names the layer the
// contract does. Mutation: rename "Contours" in `MAP_TERRAIN.copy`
// (shared/src/contracts/mapTerrain.ts) without the message.
describe("the toasts for a Terrain layer whose map file is missing", () => {
  it("name every layer as the contract does", () => {
    expect(TERRAIN_LAYER_KEYS.length).toBeGreaterThan(0);
    expect(Object.keys(TERRAIN_UNAVAILABLE_MESSAGE).sort()).toEqual(
      [...TERRAIN_LAYER_KEYS].sort(),
    );
    for (const key of TERRAIN_LAYER_KEYS) {
      expect(
        TERRAIN_UNAVAILABLE_MESSAGE[key].startsWith(MAP_TERRAIN.copy[key]),
      ).toBe(true);
    }
  });

  it("names Vegetation as the contract does", () => {
    expect(
      VEGETATION_UNAVAILABLE_MESSAGE.startsWith(MAP_TERRAIN.copy.vegetation),
    ).toBe(true);
  });
});
