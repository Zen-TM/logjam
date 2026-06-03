import { describe, it, expect } from "vitest";
import {
  RASTER_TEMPLATE_DEFAULTS,
  VECTOR_STYLE_DEFAULTS,
  cloneRasterTemplateSettings,
  cloneVectorStyleSettings,
  parseRgbaHex,
  rgbaToHex,
  rgbaCssFromHex,
  contourWidthStops,
  featureLineWidthStops,
  lerpZoom,
  iconTargetPx,
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

describe("vector paint helpers", () => {
  it("rgbaCssFromHex converts alpha to 0..1", () => {
    expect(rgbaCssFromHex("#11223380")).toBe("rgba(17,34,51,0.502)");
    expect(rgbaCssFromHex("#000000ff")).toBe("rgba(0,0,0,1.000)");
  });

  it("contourWidthStops floors z12 at 0.3", () => {
    expect(contourWidthStops(18)).toEqual({ z12: 0.9, z18: 2.25 });
    expect(contourWidthStops(0.1).z12).toBe(0.3); // tiny width still floored
  });

  it("featureLineWidthStops floors z12 at 0.25", () => {
    expect(featureLineWidthStops(4)).toEqual({ z12: 1, z18: 4 });
    expect(featureLineWidthStops(0.4).z12).toBe(0.25);
  });

  it("lerpZoom interpolates and clamps to [12,18]", () => {
    expect(lerpZoom(12, 1, 4)).toBe(1);
    expect(lerpZoom(18, 1, 4)).toBe(4);
    expect(lerpZoom(15, 0, 6)).toBe(3);
    expect(lerpZoom(10, 1, 4)).toBe(1); // clamped low
    expect(lerpZoom(20, 1, 4)).toBe(4); // clamped high
  });

  it("iconTargetPx mirrors the Python sizing law", () => {
    expect(iconTargetPx(20, 18)).toBe(20);
    expect(iconTargetPx(18, 18)).toBe(18);
    expect(iconTargetPx(20, 12)).toBe(16);
    expect(iconTargetPx(18, 12)).toBe(15);
    expect(iconTargetPx(20, 15)).toBe(18);
    expect(iconTargetPx(20, 6)).toBe(12); // floored at 12
  });
});
