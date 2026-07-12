import { describe, it, expect } from "vitest";
import { formatAreaKm2 } from "./formatArea";

describe("formatAreaKm2 (TOPO-4)", () => {
  it("shows two decimals under 10 km² so small draws are visible", () => {
    expect(formatAreaKm2(0.3)).toBe("0.30 km²");
    expect(formatAreaKm2(0.49)).toBe("0.49 km²");
    expect(formatAreaKm2(9.994)).toBe("9.99 km²");
  });

  it("rounds to whole km² from 10 km² up", () => {
    expect(formatAreaKm2(10)).toBe("10 km²");
    expect(formatAreaKm2(152.6)).toBe("153 km²");
  });

  it("never renders a nonzero draw as 0.00", () => {
    expect(formatAreaKm2(0.001)).toBe("<0.01 km²");
    expect(formatAreaKm2(0.005)).toBe("0.01 km²"); // rounds up at the boundary
  });

  it("renders a genuinely zero area as 0.00 km²", () => {
    expect(formatAreaKm2(0)).toBe("0.00 km²");
  });

  it("throws on invalid input (fail loudly)", () => {
    expect(() => formatAreaKm2(-1)).toThrow();
    expect(() => formatAreaKm2(NaN)).toThrow();
  });
});
