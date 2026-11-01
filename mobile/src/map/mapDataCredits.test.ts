import { TERRAIN_LAYER_KEYS, type TerrainLayerKey } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { mapDataAttribution } from "./mapDataCredits";
import type { ResolvedTileSource } from "./sourceResolver";

const ok = (key: string, attribution?: string): ResolvedTileSource => ({
  status: "ok",
  key,
  sourceType: "raster-dem",
  origin: "remote",
  ...(attribution && { attribution }),
});

describe("mapDataAttribution", () => {
  // Mutation: list the Terrain layers by hand, and one added to
  // TERRAIN_LAYER_KEYS is drawn without its credit.
  it("credits the basemap and every Terrain layer drawn, once each", () => {
    const terrain = Object.fromEntries(
      TERRAIN_LAYER_KEYS.map((key) => [
        key,
        [ok(key, key), ok(`${key}2`, key)],
      ]),
    ) as Record<TerrainLayerKey, ResolvedTileSource[]>;
    expect(mapDataAttribution([ok("b", "Basemap")], terrain)).toBe(
      ["Basemap", ...TERRAIN_LAYER_KEYS].join(" · "),
    );
  });

  it("skips sources that report no credit or are unavailable", () => {
    expect(
      mapDataAttribution(
        [
          ok("b"),
          { status: "unavailable", key: "x", reason: "online-only-source" },
        ],
        { contours: [], slope: [ok("s", "Slope")], land: [], hillshade: [] },
      ),
    ).toBe("Slope");
  });
});
