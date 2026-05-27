import { describe, it, expect } from "vitest";
import {
  RASTER_TEMPLATE_DEFAULTS,
  VECTOR_STYLE_DEFAULTS,
  cloneRasterTemplateSettings,
  cloneVectorStyleSettings,
  parseRgbaHex,
  rgbaToHex,
  validateRasterTemplateSettings,
  validateVectorStyleSettings,
} from "./topoSettings";

describe("RasterTemplateSettings", () => {
  it("defaults round-trip through validator", () => {
    const result = validateRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS);
    expect(result.ok).toBe(true);
  });

  it("rejects too many slope bands", () => {
    const bad = cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS);
    bad.slope.bands = Array.from({ length: 9 }, (_, i) => ({
      fromDeg: i * 5,
      toDeg: i * 5 + 1,
      colour: "#ff000080",
    }));
    const result = validateRasterTemplateSettings(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/max length is 8/);
    }
  });

  it("rejects overlapping slope bands", () => {
    const bad = cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS);
    bad.slope.bands = [
      { fromDeg: 30, toDeg: 50, colour: "#ffff008c" },
      { fromDeg: 45, toDeg: 60, colour: "#ffa500a0" },
    ];
    const result = validateRasterTemplateSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range hillshade azimuth", () => {
    const bad = cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS);
    bad.hillshade.azimuth = 400;
    const result = validateRasterTemplateSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects minRatio >= maxRatio", () => {
    const bad = cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS);
    bad.vegetation.minRatio = 0.5;
    bad.vegetation.maxRatio = 0.5;
    const result = validateRasterTemplateSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid RGBA hex", () => {
    const bad = cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS);
    bad.hillshade.colour = "#fff";
    const result = validateRasterTemplateSettings(bad);
    expect(result.ok).toBe(false);
  });
});

describe("VectorStyleSettings", () => {
  it("defaults round-trip through validator", () => {
    const result = validateVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    expect(result.ok).toBe(true);
  });

  it("rejects invalid contour colour", () => {
    const bad = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    bad.contours.majorColour = "#fff";
    const result = validateVectorStyleSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects negative contour width", () => {
    const bad = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    bad.contours.majorWidthM = -1;
    const result = validateVectorStyleSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects missing OSM feature key", () => {
    const bad = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    // @ts-expect-error — deliberate corruption
    delete bad.features.waterway;
    const result = validateVectorStyleSettings(bad);
    expect(result.ok).toBe(false);
  });
});

describe("helpers", () => {
  it("parseRgbaHex / rgbaToHex round-trip", () => {
    expect(parseRgbaHex("#11223344")).toEqual([0x11, 0x22, 0x33, 0x44]);
    expect(rgbaToHex(0x11, 0x22, 0x33, 0x44)).toBe("#11223344");
  });
});
