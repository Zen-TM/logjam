import { describe, expect, it } from "vitest";
import { hexToHsva, hsvaToHex, isHexRgba } from "./colour";

describe("colour arithmetic", () => {
  it("round-trips the stored form, opacity included", () => {
    for (const hex of ["#ffffffff", "#000000ff", "#dc2626b4", "#ffff008c", "#006400ff", "#12345600"]) {
      expect(hsvaToHex(hexToHsva(hex))).toBe(hex);
    }
  });

  it("reads hue, saturation, value and alpha", () => {
    expect(hexToHsva("#ff000080")).toEqual({ h: 0, s: 100, v: 100, a: 128 / 255 });
    expect(hexToHsva("#808080ff").s).toBe(0);
  });

  // A malformed value is a bug upstream, not a colour to guess at.
  it("refuses anything that is not #RRGGBBAA", () => {
    expect(isHexRgba("#ffffff")).toBe(false);
    expect(() => hexToHsva("#ffffff")).toThrow();
  });
});
