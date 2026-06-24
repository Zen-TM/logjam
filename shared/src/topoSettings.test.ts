import { describe, it, expect } from "vitest";
import {
  RASTER_TEMPLATE_DEFAULTS,
  VECTOR_STYLE_DEFAULTS,
  cloneRasterTemplateSettings,
  cloneVectorStyleSettings,
  parseRgbaHex,
  rgbaToHex,
  applySlopeGradient,
  rgbaCssFromHex,
  contourWidthStops,
  featureLineWidthStops,
  lerpZoom,
  iconTargetPx,
  validateRasterTemplateSettings,
  validateVectorStyleSettings,
  slopeBandsError,
} from "./topoSettings";
import type { SlopeBand } from "./topoSettings";

describe("slopeBandsError", () => {
  const band = (fromDeg: number, toDeg: number): SlopeBand => ({
    fromDeg,
    toDeg,
    colour: "#ff000080",
  });

  it("accepts contiguous ascending integer bands", () => {
    expect(slopeBandsError([band(25, 35), band(35, 50), band(50, 90)])).toBeNull();
  });

  it("rejects an empty list", () => {
    expect(slopeBandsError([])).toMatch(/at least one/i);
  });

  it("rejects from >= to within a band", () => {
    expect(slopeBandsError([band(40, 40)])).toMatch(/from.*less than.*to/i);
  });

  it("rejects a gap between bands", () => {
    expect(slopeBandsError([band(25, 35), band(40, 50)])).toMatch(/must start where band 1 ends/i);
  });

  it("rejects an overlap between bands", () => {
    expect(slopeBandsError([band(25, 40), band(35, 50)])).toMatch(/must start where band 1 ends/i);
  });

  it("rejects out-of-range and non-integer angles", () => {
    expect(slopeBandsError([band(-1, 30)])).toMatch(/between 0 and 90/i);
    expect(slopeBandsError([band(0, 91)])).toMatch(/between 0 and 90/i);
    expect(slopeBandsError([band(0, 30.5)])).toMatch(/whole numbers/i);
  });
});

describe("applySlopeGradient", () => {
  const band = (fromDeg: number, toDeg: number, colour = "#00000000"): SlopeBand => ({
    fromDeg,
    toDeg,
    colour,
  });

  it("lands endpoints exactly on the first and last band", () => {
    const out = applySlopeGradient(
      [band(40, 50), band(50, 60), band(60, 70), band(70, 90)],
      "#ffff008c",
      "#780000c8",
    );
    expect(out[0].colour).toBe("#ffff008c");
    expect(out[out.length - 1].colour).toBe("#780000c8");
  });

  it("interpolates a midpoint band halfway in every channel incl. alpha", () => {
    // Three equal bands → middle midpoint sits exactly at t=0.5.
    const out = applySlopeGradient(
      [band(0, 10), band(10, 20), band(20, 30)],
      "#00000000",
      "#ffffffff",
    );
    expect(out[1].colour).toBe("#80808080");
    expect(out[1].colour).toBe(rgbaToHex(127.5, 127.5, 127.5, 127.5));
  });

  it("maps unequal-width bands proportionally by angle midpoint", () => {
    // Midpoints: 5, 25, 50 → span 45. Middle t = 20/45 ≈ 0.444.
    const out = applySlopeGradient(
      [band(0, 10), band(10, 40), band(40, 60)],
      "#00000000",
      "#ff000000",
    );
    const [r] = parseRgbaHex(out[1].colour);
    expect(r).toBe(Math.round((20 / 45) * 255));
  });

  it("preserves band ranges and does not mutate the input", () => {
    const input = [band(40, 50), band(50, 90)];
    const out = applySlopeGradient(input, "#11223344", "#55667788");
    expect(out.map((b) => [b.fromDeg, b.toDeg])).toEqual([[40, 50], [50, 90]]);
    expect(input[0].colour).toBe("#00000000");
  });

  it("gives a single band the start colour", () => {
    const out = applySlopeGradient([band(40, 90)], "#abcdef12", "#00000000");
    expect(out[0].colour).toBe("#abcdef12");
  });
});

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

  it("defaults labelScale to 1 when absent (pre-existing stored styles)", () => {
    const legacy = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    // @ts-expect-error — simulate a style stored before labelScale existed
    delete legacy.labelScale;
    const result = validateVectorStyleSettings(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.labelScale).toBe(1);
  });

  it("rejects out-of-range labelScale", () => {
    const bad = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    bad.labelScale = 5;
    const result = validateVectorStyleSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("accepts an in-range labelScale", () => {
    const ok = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    ok.labelScale = 1.6;
    const result = validateVectorStyleSettings(ok);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.labelScale).toBe(1.6);
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
