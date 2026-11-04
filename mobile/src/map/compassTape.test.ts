import { describe, expect, it } from "vitest";

import {
  COMPASS_PX_PER_DEGREE,
  compassLabelFits,
  compassStripWidth,
  compassTicks,
  displayHeading,
} from "./compassTape";
import { NSW_MAGNETIC_DECLINATION_DEG } from "./heading";

const WIDTH = 260;

describe("compassTicks", () => {
  it("puts the faced bearing on the centre line", () => {
    const centre = compassTicks(90, WIDTH).find((tick) => tick.bearing === 90);
    expect(centre).toBeDefined();
    expect(centre?.x).toBeCloseTo(WIDTH / 2, 5);
    expect(centre?.label).toBe("E");
  });

  it("labels cardinals as letters and the rest in degrees", () => {
    const labels = compassTicks(270, WIDTH)
      .filter((tick) => tick.label)
      .map((tick) => tick.label);
    expect(labels).toContain("W");
    expect(labels).toContain("240");
    expect(labels).toContain("300");
  });

  it("crosses north the short way", () => {
    // Facing 350°: north is 10° clockwise, so it must be drawn to the RIGHT of
    // centre — the bug a plain (bearing - heading) would produce is -340°.
    const north = compassTicks(350, WIDTH).find((tick) => tick.bearing === 0);
    expect(north?.x).toBeCloseTo(WIDTH / 2 + 10 * COMPASS_PX_PER_DEGREE, 5);
  });

  it("slides continuously between whole-degree headings", () => {
    const at90 = compassTicks(90, WIDTH).find((t) => t.bearing === 90)!;
    const at91 = compassTicks(91, WIDTH).find((t) => t.bearing === 90)!;
    expect(at90.x - at91.x).toBeCloseTo(COMPASS_PX_PER_DEGREE, 5);
  });

  it("has nothing to draw without a width or a heading", () => {
    expect(compassTicks(0, 0)).toEqual([]);
    expect(compassTicks(Number.NaN, WIDTH)).toEqual([]);
  });
});

describe("displayHeading", () => {
  it("passes true headings through untouched", () => {
    expect(displayHeading(0, "true")).toBe(0);
    expect(displayHeading(237.4, "true")).toBe(237.4);
  });

  // The direction that matters. NSW's declination is EASTERLY, so magnetic
  // north sits east of true north and the same direction takes a SMALLER
  // number measured from it. Backwards here is 25° of error in where someone
  // walks off a plateau.
  it("subtracts the easterly declination for magnetic", () => {
    expect(displayHeading(100, "magnetic")).toBeCloseTo(87.5);
    expect(
      displayHeading(NSW_MAGNETIC_DECLINATION_DEG, "magnetic"),
    ).toBeCloseTo(0);
  });

  it("wraps below zero rather than going negative", () => {
    expect(displayHeading(0, "magnetic")).toBeCloseTo(347.5);
    expect(displayHeading(5, "magnetic")).toBeCloseTo(352.5);
  });
});

describe("compassLabelFits", () => {
  // Mutation: compare against the tick's x alone (drop the half label width)
  // and a "240" half off the left edge of the tape is drawn as "24".
  it("holds back a label that would be clipped at either end", () => {
    const label = 45; // a three-digit bearing at text size 1.5
    expect(compassLabelFits(10, 176, label)).toBe(false);
    expect(compassLabelFits(166, 176, label)).toBe(false);
    expect(compassLabelFits(88, 176, label)).toBe(true);
    expect(compassLabelFits(22.5, 176, label)).toBe(true);
  });
  // Mutation: return a flat 176 from compassStripWidth, and at 1.5 some
  // headings leave a single label in full.
  it.each([1, 1.15, 1.3, 1.5])(
    "always leaves two labels in full at text size %s",
    (scale) => {
      const width = compassStripWidth(scale);
      const label = Math.round(30 * scale);
      for (let heading = 0; heading < 360; heading += 1) {
        const shown = compassTicks(heading, width).filter(
          (tick) => tick.label && compassLabelFits(tick.x, width, label),
        );
        expect(shown.length).toBeGreaterThanOrEqual(2);
      }
    },
  );
});
