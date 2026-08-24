import { describe, it, expect } from "vitest";
import { chooseScaleStep, degreesPerDp, metersPerPixel } from "./scaleBar";

describe("metersPerPixel", () => {
  it("matches MapLibre's 512-based resolution at the equator", () => {
    // Half the familiar slippy-tile figures: MapLibre's zoom puts 512 points
    // across a tile, so z0 is the whole world in 512, not 256 (see scaleBar.ts).
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
    expect(() => metersPerPixel(Number.NaN, 10)).toThrow(/latitude out of range/);
    expect(() => metersPerPixel(0, -1)).toThrow(/zoom out of range/);
  });
});

describe("chooseScaleStep", () => {
  it("picks the largest round step that fits the offered width", () => {
    // 1 m/px over 300 px offers 300 m → 200 m is the largest round step.
    const step = chooseScaleStep(1, 300);
    expect(step.meters).toBe(200);
    expect(step.widthPx).toBe(200);
    expect(step.label).toBe("200 m");
  });

  it("never draws wider than the space offered", () => {
    for (const zoom of [0, 4, 8, 11, 14, 17, 20]) {
      const step = chooseScaleStep(metersPerPixel(-33.7, zoom), 280);
      expect(step.widthPx).toBeLessThanOrEqual(280);
      expect(step.widthPx).toBeGreaterThan(0);
    }
  });

  it("labels kilometres once past 1000 m", () => {
    expect(chooseScaleStep(10, 300).label).toBe("2 km");
    expect(chooseScaleStep(100, 300).label).toBe("20 km");
  });

  it("clamps to the offered width when even the smallest step overflows", () => {
    // 1000 m/px over 0.5 px offers 500 m of ground in half a pixel; the
    // smallest round step (1 m) would still need 0.001 px, so it fits — force
    // the overflow branch with a metersPerPixel above the whole offer.
    const step = chooseScaleStep(1000, 0.0005);
    expect(step.widthPx).toBe(0.0005);
    expect(step.meters).toBe(1);
  });

  it("throws on degenerate input", () => {
    expect(() => chooseScaleStep(0, 300)).toThrow(/bad metersPerPixel/);
    expect(() => chooseScaleStep(1, 0)).toThrow(/bad maxWidthPx/);
  });
});

describe("degreesPerDp", () => {
  it("uses the same 512-based world the scale bar does", () => {
    // Not 256, and not divided by the display density: the anchor hit test
    // did both, which left a 20 dp reach measuring under 15 dp.
    expect(degreesPerDp(0)).toBeCloseTo(360 / 512, 10);
    expect(degreesPerDp(1)).toBeCloseTo(degreesPerDp(0) / 2, 10);
  });

  it("agrees with metersPerPixel at the equator", () => {
    // Two derivations of the same convention, so a change to one that does not
    // reach the other fails here.
    const metresPerDegree = 40075016.686 / 360;
    expect(degreesPerDp(14) * metresPerDegree).toBeCloseTo(
      metersPerPixel(0, 14),
      6,
    );
  });

  it("refuses a nonsense zoom rather than sizing a hit test off NaN", () => {
    expect(() => degreesPerDp(Number.NaN)).toThrow();
    expect(() => degreesPerDp(-1)).toThrow();
  });
});
