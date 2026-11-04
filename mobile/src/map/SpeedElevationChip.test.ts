import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The chip is a glance beside the scale bar, not a hero (mobile/DESIGN.md §3).
// Mutation: restore `...textRole.instrument` on `value` (red: the 28 px figures
// are back), set `width` instead of `minWidth` or drop a value's
// `numberOfLines={1}` (red: a large system text size wraps "12.5 km/h" past the
// height the compass is placed by).
describe("SpeedElevationChip", () => {
  const source = readFileSync(
    new URL("./SpeedElevationChip.tsx", import.meta.url),
    "utf8",
  ).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
  it("draws its figures at the control size, not instrument", () => {
    expect(source).not.toContain("textRole.instrument");
    expect(source).toContain("...textRole.control");
  });
  it("grows with the text size and keeps each value on one line", () => {
    expect(source).toContain("minWidth: CHIP_MIN_WIDTH");
    expect(source).not.toMatch(/\bwidth: CHIP/);
    expect(
      source.match(/numberOfLines=\{1\}\s+style=\{\[styles\.value/g),
    ).toHaveLength(2);
  });
});
