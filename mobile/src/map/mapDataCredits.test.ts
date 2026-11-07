import {
  TERRAIN_LAYER_KEYS,
  WEATHER_MAP,
  type TerrainLayerKey,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { mapDataAttribution } from "./mapDataCredits";
import type { ResolvedTileSource } from "./sourceResolver";
import { weatherFixture } from "../weatherMap/weatherMapFixture";
import { weatherSource } from "./weatherLayers";

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
        {
          contours: [],
          slope: [ok("s", "Slope")],
          land: [],
          fire: [],
          coverage: [],
          weather: [],
          hillshade: [],
        },
      ),
    ).toBe("Slope");
  });

  // Mutation: leave `weather` out of the attribution's layers, and the
  // overlay is drawn without CC BY 4.0's credit; credit it while nothing is
  // drawn, and "Map data" names a source the map is not showing.
  it("credits Open-Meteo only while the Weather field is drawn", () => {
    const none = Object.fromEntries(
      TERRAIN_LAYER_KEYS.map((key) => [key, []]),
    ) as unknown as Record<TerrainLayerKey, ResolvedTileSource[]>;
    expect(mapDataAttribution([ok("b")], none)).toBe("");
    expect(
      mapDataAttribution([ok("b")], {
        ...none,
        weather: [
          weatherSource("https://cdn.example", weatherFixture, "rain", 0)!,
        ],
      }),
    ).toBe(WEATHER_MAP.credit);
  });
});
