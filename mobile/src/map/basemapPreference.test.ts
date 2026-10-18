import { describe, expect, it, vi } from "vitest";

vi.mock("../prefsDb", () => ({
  readPref: vi.fn(() => storedValue),
  writePref: vi.fn(() => true),
}));

let storedValue: string | null = null;

const { readBasemapPreference, readTerrainLayers } = await import(
  "./basemapPreference"
);
const { DEFAULT_BASEMAP } = await import("./basemapMeta");

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

describe("readTerrainLayers", () => {
  it("is the contours alone until the user switches", () => {
    storedValue = null;
    expect(readTerrainLayers()).toEqual({
      contours: true,
      slope: false,
      hillshade: false,
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
      hillshade: false,
    });
  });
});
