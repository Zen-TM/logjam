import { describe, expect, it } from "vitest";

import { assetHue, withAlpha } from "./theme";

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
