import { describe, expect, it, vi } from "vitest";

vi.mock("../prefsDb", () => ({
  readPref: vi.fn(() => storedValue),
  writePref: vi.fn(() => true),
}));

vi.mock("../regionsPreference", () => ({ readRegions: () => ["nsw"] }));

let storedValue: string | null = null;

const {
  readBasemapPreference,
  readGaugesLayer,
  readMgaGridLayer,
  readTerrainLayers,
} = await import("./basemapPreference");
const { defaultBasemap } = await import("./basemapMeta");
const DEFAULT_BASEMAP = defaultBasemap(["nsw"]);

describe("readBasemapPreference", () => {
  it("returns the stored basemap", () => {
    storedValue = "osm-cycle";
    expect(readBasemapPreference()).toBe("osm-cycle");
  });

  it("falls back to the default when nothing is recorded", () => {
    storedValue = null;
    expect(readBasemapPreference()).toBe(DEFAULT_BASEMAP);
  });

  it("falls back for an id Logjam GPS does not offer", () => {
    // "osm" is not in the Logjam GPS picker; an older build's pick must not
    // reach the resolver, which throws on an unknown basemap id.
    storedValue = "osm";
    expect(readBasemapPreference()).toBe(DEFAULT_BASEMAP);
  });
});

describe("the overlays a fresh install draws", () => {
  // Mutation: read an unset preference as "on", and the grid lines show over
  // every map (and the gauge file is fetched) before anyone asks.
  it("has no river gauges and no MGA grid until switched on", () => {
    storedValue = null;
    expect(readGaugesLayer()).toBe(false);
    expect(readMgaGridLayer()).toBe(false);
    storedValue = "on";
    expect(readGaugesLayer()).toBe(true);
    expect(readMgaGridLayer()).toBe(true);
  });
});

describe("readTerrainLayers", () => {
  it("is the contours, slope and any vegetation until the user switches", () => {
    storedValue = null;
    expect(readTerrainLayers()).toEqual({
      contours: true,
      slope: true,
      land: false,
      hillshade: false,
      vegetation: true,
    });
  });

  // Mutation: let the JSON.parse throw, and one damaged preference stops the
  // map from opening at all.
  it("reads a damaged preference as the defaults", () => {
    storedValue = "{not json";
    expect(readTerrainLayers().contours).toBe(true);
    storedValue = JSON.stringify({ contours: false, slope: true });
    expect(readTerrainLayers()).toEqual({
      contours: false,
      slope: true,
      land: false,
      hillshade: false,
      vegetation: true,
    });
  });
});
