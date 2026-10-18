import { describe, expect, it } from "vitest";
import { keptFrameSizePx, metresPerPixel } from "./geoPdfFrame";

// Mutation: the 256-tile constant 156543.03 (the frame then covers half the
// ground at the scale it was kept at).
describe("metresPerPixel", () => {
  it("is MapLibre's 512px-tile ground resolution", () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(78271.52, 2);
    expect(metresPerPixel(14, -33.7)).toBeCloseTo(3.9745, 3);
  });
});

// A kept scale holds the frame to the paper's ground size, so a zoom grows
// or shrinks the frame on screen. Mutations: leave out the zoom (the frame
// stays put and the area silently changes scale); size from the sheet's
// height for its width.
describe("keptFrameSizePx", () => {
  const a4MapArea = { w: 190, h: 277 };

  it("is the paper's ground size in pixels", () => {
    const px = keptFrameSizePx(25000, a4MapArea, 14, -33.7);
    expect(px.w * metresPerPixel(14, -33.7)).toBeCloseTo(4750, 6);
    expect(px.h * metresPerPixel(14, -33.7)).toBeCloseTo(6925, 6);
  });

  it("doubles with each zoom level in", () => {
    const out = keptFrameSizePx(25000, a4MapArea, 13, -33.7);
    const zoomedIn = keptFrameSizePx(25000, a4MapArea, 14, -33.7);
    expect(zoomedIn.w).toBeCloseTo(out.w * 2, 6);
  });
});
