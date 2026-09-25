import { describe, expect, it, vi } from "vitest";

vi.mock("../prefsDb", () => ({
  readPref: vi.fn(() => storedValue),
  writePref: vi.fn(() => true),
}));

let storedValue: string | null = null;

const { readBasemapPreference } = await import("./basemapPreference");
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

  it("falls back for an id mobile no longer offers", () => {
    // "osm" was dropped from the mobile picker; an older build's pick must not
    // reach the resolver, which throws on an unknown basemap id.
    storedValue = "osm";
    expect(readBasemapPreference()).toBe(DEFAULT_BASEMAP);
  });
});
