import { GEOPDF_PADDING_MM, PAPER_SIZES_MM } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { checkPlan, peakCanvasPx, TILE_CANVAS_ALLOWANCE_PX } from "./probe";
import {
  planStrips,
  STRIP_MAX_PX,
  STRIP_OVERLAP_ROWS,
  STRIP_ROW_MULTIPLE,
} from "./strips";

/** The map box the renderer draws for a paper, at the given dpi. */
function mapPx(paper: "A3" | "A4", dpi: number): { w: number; h: number } {
  const { w, h } = PAPER_SIZES_MM[paper];
  const px = (mm: number) =>
    Math.round(((mm - 2 * GEOPDF_PADDING_MM) / 25.4) * dpi);
  return { w: px(h), h: px(w) }; // landscape
}

const IPHONE = {
  maxCanvasPx: 16_600_000,
  maxTotalPx: 64_000_000,
  maxWidth: 65_536,
};
const DESKTOP = { maxCanvasPx: 128e6, maxTotalPx: 256e6, maxWidth: 65_473 };

describe("planStrips", () => {
  const a3 = mapPx("A3", 320); // ~17.6 MP: the A3 case from #602
  const a4 = mapPx("A4", 320); // ~8.7 MP
  it("is one strip when the map fits", () => {
    const s = planStrips(a3.w, a3.h, 20e6);
    expect(s).toEqual([{ index: 0, y: 0, height: a3.h, renderHeight: a3.h }]);
  });

  it("splits a 17 MP map in two on an iPhone limit", () => {
    expect(a3.w * a3.h).toBeGreaterThan(16_600_000);
    const s = planStrips(a3.w, a3.h, STRIP_MAX_PX);
    expect(s).toHaveLength(2);
    expect(checkPlan(a3.w, a3.h, IPHONE)).toEqual({ ok: true, strips: s });
  });

  it("never plans a strip past STRIP_MAX_PX, even on desktop limits", () => {
    const c = checkPlan(a3.w, a3.h, DESKTOP);
    expect(c.ok && c.strips).toHaveLength(2);
    expect(checkPlan(a4.w, a4.h, DESKTOP).ok).toBe(true);
  });

  // mutation: drop the `* STRIP_ROW_MULTIPLE` rounding -> heights stop being multiples of 16
  // mutation: tile y with `index * ownable` instead of the equalised height -> gaps or overlap in coverage
  // mutation: drop the overlap clip `mapHeight - y` -> the last strip draws past the map
  // mutation: size strips as height <= maxRows (forgetting the overlap) -> width*renderHeight exceeds the max
  it.each([
    [4000, 9001, STRIP_MAX_PX],
    [a3.w, a3.h, STRIP_MAX_PX],
    [1000, 100_000, 5_000_000],
    [333, 12_345, 400_000],
    [4000, 4001, 16_000_000],
  ])("tiles %i x %i exactly, in 16s, within the max", (w, h, max) => {
    const s = planStrips(w, h, max);
    let y = 0;
    for (const [i, st] of s.entries()) {
      expect(st.index).toBe(i);
      expect(st.y).toBe(y);
      if (i < s.length - 1) {
        expect(st.height % STRIP_ROW_MULTIPLE).toBe(0);
        expect(st.renderHeight).toBe(
          Math.min(st.height + STRIP_OVERLAP_ROWS, h - st.y),
        );
      } else {
        expect(st.renderHeight).toBe(st.height);
      }
      expect(w * st.renderHeight).toBeLessThanOrEqual(max);
      y += st.height;
    }
    expect(y).toBe(h);
  });

  // mutation: start the count at ceil(h / maxRows) instead of from the overlap-aware height -> more strips than needed or too tall
  it("uses the fewest strips", () => {
    // maxRows 100 -> a strip owns 80 rows; 160 rows need 2, 161 need 3.
    expect(planStrips(10, 160, 1000)).toHaveLength(2);
    expect(planStrips(10, 161, 1000)).toHaveLength(3);
  });

  it("rejects rows too wide for a 16-row strip plus its overlap", () => {
    expect(() => planStrips(1000, 100, 31_999)).toThrow(RangeError);
    expect(() => planStrips(0, 100, 1000)).toThrow(RangeError);
  });
});

describe("checkPlan", () => {
  const m = { maxCanvasPx: STRIP_MAX_PX, maxTotalPx: 1e9, maxWidth: 1e6 };

  // mutation: remove the maxWidth comparison
  it("refuses a map wider than the browser's widest canvas", () => {
    expect(checkPlan(5000, 100, { ...m, maxWidth: 4999 })).toEqual({
      ok: false,
    });
    expect(checkPlan(5000, 100, { ...m, maxWidth: 5000 }).ok).toBe(true);
  });

  // mutation: use STRIP_MAX_PX alone instead of min(STRIP_MAX_PX, maxCanvasPx)
  it("plans within a smaller canvas limit", () => {
    const c = checkPlan(4000, 4000, { ...m, maxCanvasPx: 4_000_000 });
    expect(c.ok && c.strips.length).toBeGreaterThan(1);
    if (c.ok)
      for (const s of c.strips)
        expect(4000 * s.renderHeight).toBeLessThanOrEqual(4_000_000);
  });

  // mutation: compare peak against maxCanvasPx or drop the check
  it("refuses when the strip and scratch canvases exceed the total budget", () => {
    const c = checkPlan(4000, 4000, { ...m, maxTotalPx: 31_000_000 });
    expect(c).toEqual({ ok: false });
    const ok = checkPlan(4000, 4000, { ...m, maxTotalPx: 34_000_000 });
    expect(ok.ok).toBe(true);
  });

  // mutation: peakCanvasPx without the factor 2 (scratch) or the allowance
  it("peak counts the strip, a same-size scratch canvas and the tile allowance", () => {
    const strip = { index: 0, y: 0, height: 100, renderHeight: 116 };
    expect(peakCanvasPx(1000, strip)).toBe(
      2 * 1000 * 116 + TILE_CANVAS_ALLOWANCE_PX,
    );
  });

  it("is not ok for an unplannable width", () => {
    expect(
      checkPlan(600_000, 100, { ...m, maxCanvasPx: 16e6, maxWidth: 1e7 }),
    ).toEqual({ ok: false });
  });
});
