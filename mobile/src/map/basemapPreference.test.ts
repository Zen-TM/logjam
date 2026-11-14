import { describe, expect, it, vi } from "vitest";
import { pointBox } from "@logjam/shared";

vi.mock("../prefsDb", () => ({
  readPref: vi.fn(() => storedValue),
  writePref: vi.fn(() => true),
}));

let chosenRegions = ["nsw"];
vi.mock("../regionsPreference", () => ({ readRegions: () => chosenRegions }));

let storedValue: string | null = null;

const {
  readBasemapPreference,
  readEffectiveBasemap,
  readCoverageCarrier,
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

  // Mutation: read the pick against the chosen regions' basemaps, and a pick
  // a map would show over NSW is lost for an account that chose another region.
  it("returns a listed pick as stored, whatever regions the account chose", () => {
    chosenRegions = [];
    storedValue = "six-imagery";
    expect(readBasemapPreference()).toBe("six-imagery");
    chosenRegions = ["nsw"];
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

describe("readEffectiveBasemap", () => {
  const inNsw = pointBox(150.3, -33.7);
  // The Tasman Sea: outside every region, so SIX Maps is not offered.
  const atSea = pointBox(160, -40);

  // Mutation: return the stored pick unchanged, and a screen opened outside
  // NSW draws a blank SIX sheet for an NSW pick.
  it("draws the stored pick where the view offers it, else what stands in", () => {
    storedValue = "six-imagery";
    expect(readEffectiveBasemap(inNsw)).toBe("six-imagery");
    expect(readEffectiveBasemap(atSea)).toBe("osm-topo");
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
      fire: false,
      coverage: false,
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
      fire: false,
      coverage: false,
      land: false,
      hillshade: false,
      vegetation: true,
    });
  });
});

describe("readCoverageCarrier", () => {
  // Mutation: return the stored string as it is, and a value no build offers
  // reaches the layer's filter, which then matches no carrier and draws
  // nothing; fall back to a carrier, and the overlay draws one never picked.
  it("reads a carrier the build offers, and nothing for anything else", () => {
    storedValue = "optus";
    expect(readCoverageCarrier()).toBe("optus");
    for (const stale of [null, "vodafone", ""]) {
      storedValue = stale;
      expect(readCoverageCarrier()).toBeNull();
    }
  });
});
