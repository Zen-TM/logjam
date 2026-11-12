import { metersPerPixel } from "@logjam/shared";
import { describe, it, expect } from "vitest";
import { chooseScaleStep, degreesPerDp, tileMetersPerPixel } from "./scaleBar";

describe("tileMetersPerPixel", () => {
  it("is exactly double metersPerPixel at the same latitude and zoom", () => {
    // The whole point of keeping two functions: a slippy-tile zoom (256-based)
    // and a MapLibre camera zoom (512-based) are off by exactly 2x at the same
    // zoom number. Applying this ratio to the wrong convention doubles or halves
    // distances. The two source constants (78271.51696 vs 156543.03392) are
    // independently rounded literals, not one computed from the other, so the
    // match is close but not bit-exact — precision 2 is well inside that rounding
    // noise and still catches a wrong power-of-two or a swapped convention outright.
    for (const zoom of [0, 8, 14, 20]) {
      expect(tileMetersPerPixel(-33.7, zoom)).toBeCloseTo(
        metersPerPixel(-33.7, zoom) * 2,
        2,
      );
    }
  });

  it("is about 2 m/px at z16 in the Blue Mountains (regionFrame's own case)", () => {
    expect(tileMetersPerPixel(-33.7, 16)).toBeGreaterThan(1.7);
    expect(tileMetersPerPixel(-33.7, 16)).toBeLessThan(2.1);
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
    // Not 256, and not divided by the display density: dividing by display
    // density shrinks a 20 dp reach to under 15 dp.
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
