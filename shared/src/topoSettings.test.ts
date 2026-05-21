import { describe, it, expect } from "vitest";
import {
  TOPO_SETTINGS_DEFAULTS,
  cloneTopoSettings,
  parseRgbaHex,
  rgbaToHex,
  validateTopoSettings,
} from "./topoSettings";

describe("topoSettings", () => {
  it("defaults round-trip through validator", () => {
    const result = validateTopoSettings(TOPO_SETTINGS_DEFAULTS);
    expect(result.ok).toBe(true);
  });

  it("rejects too many slope bands", () => {
    const bad = cloneTopoSettings(TOPO_SETTINGS_DEFAULTS);
    bad.slope.bands = Array.from({ length: 9 }, (_, i) => ({
      fromDeg: i * 5,
      toDeg: i * 5 + 1,
      colour: "#ff000080",
    }));
    const result = validateTopoSettings(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/max length is 8/);
    }
  });

  it("rejects overlapping slope bands", () => {
    const bad = cloneTopoSettings(TOPO_SETTINGS_DEFAULTS);
    bad.slope.bands = [
      { fromDeg: 30, toDeg: 50, colour: "#ffff008c" },
      { fromDeg: 45, toDeg: 60, colour: "#ffa500a0" },
    ];
    const result = validateTopoSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range hillshade azimuth", () => {
    const bad = cloneTopoSettings(TOPO_SETTINGS_DEFAULTS);
    bad.hillshade.azimuth = 400;
    const result = validateTopoSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects minRatio >= maxRatio", () => {
    const bad = cloneTopoSettings(TOPO_SETTINGS_DEFAULTS);
    bad.vegetation.minRatio = 0.5;
    bad.vegetation.maxRatio = 0.5;
    const result = validateTopoSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid RGBA hex", () => {
    const bad = cloneTopoSettings(TOPO_SETTINGS_DEFAULTS);
    bad.hillshade.colour = "#fff";
    const result = validateTopoSettings(bad);
    expect(result.ok).toBe(false);
  });

  it("parseRgbaHex / rgbaToHex round-trip", () => {
    expect(parseRgbaHex("#11223344")).toEqual([0x11, 0x22, 0x33, 0x44]);
    expect(rgbaToHex(0x11, 0x22, 0x33, 0x44)).toBe("#11223344");
  });
});
