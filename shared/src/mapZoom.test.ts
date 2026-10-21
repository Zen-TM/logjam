import { describe, expect, it } from "vitest";
import { metersPerPixel } from "./mapZoom.js";

// Mutation: the 256-based 156543.034 constant (every distance doubles).
describe("metersPerPixel", () => {
  it("matches MapLibre's 512-based resolution at the equator", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.51696, 3);
    expect(metersPerPixel(0, 10)).toBeCloseTo(76.43702827, 5);
  });

  it("shrinks with latitude (NSW canyoning country is ~-33)", () => {
    const equator = metersPerPixel(0, 14);
    const nsw = metersPerPixel(-33.7, 14);
    expect(nsw).toBeLessThan(equator);
    expect(nsw).toBeCloseTo(equator * Math.cos((33.7 * Math.PI) / 180), 6);
  });

  it("is sign-agnostic about hemisphere", () => {
    expect(metersPerPixel(-33.7, 12)).toBeCloseTo(metersPerPixel(33.7, 12), 9);
  });

  it("throws on out-of-range input rather than returning NaN", () => {
    expect(() => metersPerPixel(91, 10)).toThrow(/latitude out of range/);
    expect(() => metersPerPixel(Number.NaN, 10)).toThrow(
      /latitude out of range/,
    );
    expect(() => metersPerPixel(0, -1)).toThrow(/zoom out of range/);
  });
});
