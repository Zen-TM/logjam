import { describe, it, expect } from "vitest";
import { TOPO_LAYERS } from "./topoSettings.js";
import {
  validateGeoPdfConfig,
  VALID_GEOPDF_OVERLAY_NAMES,
  type GeoPdfConfig,
} from "./geoPdfConfig.js";

// A minimal valid config; tests clone + mutate this.
function validConfig(): GeoPdfConfig {
  return {
    paperSize: "A4",
    orientation: "portrait",
    extent: { north: -33.4, south: -33.6, east: 150.4, west: 150.2 },
    scale: 25000,
    baseLayer: "osm",
    overlays: ["hillshade", "contours"],
    elements: { compass: true, scaleText: true, scaleBar: true },
    placeMarkers: [{ lat: -33.5, lon: 150.3, name: "Test", color: "owned" }],
  };
}

describe("validateGeoPdfConfig", () => {
  it("accepts a fully valid config", () => {
    expect(validateGeoPdfConfig(validConfig())).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(validateGeoPdfConfig(null)).toBe("config must be an object");
    expect(validateGeoPdfConfig("x")).toBe("config must be an object");
    expect(validateGeoPdfConfig(42)).toBe("config must be an object");
  });

  it("rejects missing required fields", () => {
    const c = validConfig() as Partial<GeoPdfConfig>;
    delete c.extent;
    expect(validateGeoPdfConfig(c)).toMatch(/Missing required fields/);
  });

  it("rejects a paper size outside the allowlist", () => {
    const c = {
      ...validConfig(),
      paperSize: "A0" as GeoPdfConfig["paperSize"],
    };
    expect(validateGeoPdfConfig(c)).toBe("Invalid paper size: A0");
  });

  it("rejects a base layer outside the allowlist", () => {
    const c = { ...validConfig(), baseLayer: "evil-tiles" };
    expect(validateGeoPdfConfig(c)).toBe("Invalid base layer: evil-tiles");
  });

  it("rejects non-numeric extent fields", () => {
    const c = validConfig();
    // @ts-expect-error deliberately wrong type
    c.extent.north = "0";
    expect(validateGeoPdfConfig(c)).toMatch(
      /north, south, east, west must be numbers/,
    );
  });

  it("rejects inverted extent (north <= south)", () => {
    const c = validConfig();
    c.extent.north = -33.7; // below south
    expect(validateGeoPdfConfig(c)).toMatch(/north must be > south/);
  });

  it("rejects inverted extent (east <= west)", () => {
    const c = validConfig();
    c.extent.east = 150.1; // below west
    expect(validateGeoPdfConfig(c)).toMatch(/north must be > south/);
  });

  it("rejects non-positive or non-numeric scale", () => {
    expect(validateGeoPdfConfig({ ...validConfig(), scale: 0 })).toBe(
      "Invalid scale",
    );
    expect(validateGeoPdfConfig({ ...validConfig(), scale: -5 })).toBe(
      "Invalid scale",
    );
    // @ts-expect-error deliberately wrong type
    expect(validateGeoPdfConfig({ ...validConfig(), scale: "big" })).toBe(
      "Invalid scale",
    );
  });

  it("rejects non-array overlays", () => {
    // @ts-expect-error deliberately wrong type
    expect(
      validateGeoPdfConfig({ ...validConfig(), overlays: "hillshade" }),
    ).toBe("Invalid overlays: must be an array");
  });

  it("rejects an unknown overlay name", () => {
    expect(
      validateGeoPdfConfig({
        ...validConfig(),
        overlays: ["hillshade", "secret"],
      }),
    ).toBe("Invalid overlay name: secret");
  });

  it("allows omitted overlays", () => {
    const c = validConfig() as Partial<GeoPdfConfig>;
    delete c.overlays;
    expect(validateGeoPdfConfig(c)).toBeNull();
  });

  it("rejects a malformed place marker", () => {
    const c = validConfig();
    // @ts-expect-error deliberately wrong color
    c.placeMarkers = [{ lat: -33.5, lon: 150.3, name: "X", color: "purple" }];
    expect(validateGeoPdfConfig(c)).toBe("Invalid place marker entry");
  });

  it("rejects non-array placeMarkers", () => {
    // @ts-expect-error deliberately wrong type
    expect(validateGeoPdfConfig({ ...validConfig(), placeMarkers: {} })).toBe(
      "Invalid placeMarkers: must be an array",
    );
  });
});

describe("VALID_GEOPDF_OVERLAY_NAMES", () => {
  // Logjam Web offers and sends every TOPO_LAYERS name but `features`, which
  // nothing draws. Mutation: add a layer to TOPO_LAYERS only, and every GeoPDF
  // from Logjam Web is refused.
  it("holds every layer Logjam Web can send", () => {
    for (const layer of TOPO_LAYERS)
      if (layer.name !== "features")
        expect(VALID_GEOPDF_OVERLAY_NAMES.has(layer.name)).toBe(true);
  });

  // Mutation: put `features` back, and a request names an overlay nothing draws.
  it("is the Terrain group and vegetation, nothing else", () => {
    expect([...VALID_GEOPDF_OVERLAY_NAMES].sort()).toEqual([
      "contours",
      "hillshade",
      "slope",
      "vegetation",
    ]);
  });
});
