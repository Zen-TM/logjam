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
  // Mutation: leave a Terrain layer out of the list, and its credit is never
  // shown while it is drawn.
  it("credits the basemap and every Terrain layer drawn, once each", () => {
    expect(
      mapDataAttribution([ok("b", "Basemap")], {
        contours: [ok("c1", "Contours"), ok("c2", "Contours")],
        slope: [ok("s", "Slope")],
        hillshade: [ok("h", "Hillshade")],
      }),
    ).toBe("Basemap · Contours · Slope · Hillshade");
  });

  it("skips sources that report no credit or are unavailable", () => {
    expect(
      mapDataAttribution(
        [
          ok("b"),
          { status: "unavailable", key: "x", reason: "online-only-source" },
        ],
        { contours: [], slope: [ok("s", "Slope")], hillshade: [] },
      ),
    ).toBe("Slope");
  });
});
