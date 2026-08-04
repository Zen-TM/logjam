import { describe, expect, it } from "vitest";

import { COMPASS_PX_PER_DEGREE, compassTicks } from "./compassTape";

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
