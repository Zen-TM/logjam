import { describe, expect, it } from "vitest";

import { assetHue, clampTextScale, withAlpha } from "./theme";

describe("withAlpha", () => {
  it("expands 3-digit and parses 6-digit hex", () => {
    expect(withAlpha("#9DBE8B", 0.16)).toBe("rgba(157,190,139,0.16)");
    expect(withAlpha("#abc", 1)).toBe("rgba(170,187,204,1)");
    expect(withAlpha("9DBE8B", 0.5)).toBe("rgba(157,190,139,0.5)");
  });

  // Fail loudly: an rgba() string round-tripped through withAlpha would
  // silently produce an unparseable colour that RN renders as transparent.
  it("throws on a non-hex colour", () => {
    expect(() => withAlpha("rgba(0,0,0,0.5)", 0.2)).toThrow(/hex colour/);
  });

  it("accepts every asset hue", () => {
    for (const hue of Object.values(assetHue)) {
      expect(withAlpha(hue, 0.16)).toMatch(/^rgba\(\d+,\d+,\d+,0\.16\)$/);
    }
  });
});

describe("clampTextScale", () => {
  it("applies the user's pick when the OS is not scaling", () => {
    expect(clampTextScale(1.3, 1)).toBe(1.3);
    expect(clampTextScale(0.9, 1)).toBe(0.9);
  });

  // The two knobs multiply, so the pair is what has to stay under the ceiling:
  // OS 1.5 x our 1.5 would be 2.25, which is a row title in three lines.
  it("gives up its own headroom to keep the COMBINED scale at or under 2", () => {
    expect(clampTextScale(1.5, 1.5)).toBeCloseTo(2 / 1.5);
    expect(clampTextScale(1.5, 2)).toBe(1);
    // Already past the ceiling on its own: we shrink rather than add to it.
    expect(clampTextScale(1.15, 4)).toBe(0.5);
  });

  it("treats a missing OS scale as 1 rather than dividing by zero", () => {
    expect(clampTextScale(1.15, 0)).toBe(1.15);
  });
});
