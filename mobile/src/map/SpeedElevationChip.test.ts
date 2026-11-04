import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readoutChipHeight, readoutChipMinWidth } from "./readoutChipSize";

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
  it("keeps each value on one line and sizes itself from the text size", () => {
    expect(source).toContain(
      "minWidth: readoutChipMinWidth(fontScale, textScale)",
    );
    expect(source).not.toMatch(/\bwidth: CHIP/);
    expect(
      source.match(/numberOfLines=\{1\}\s+style=\{\[styles\.value/g),
    ).toHaveLength(2);
  });
});

// Mutation: return CHIP_MIN_WIDTH unscaled (the 168 box that cut "0.0 km/h" at
// 1.5x), or drop `fontScale` from the height.
describe("the chip's size follows the text size", () => {
  it("grows its width with the system and Logjam text scales, never below 168", () => {
    expect(readoutChipMinWidth(1, 1)).toBe(168);
    expect(readoutChipMinWidth(0.85, 1)).toBe(168);
    expect(readoutChipMinWidth(1.5, 1)).toBe(252);
    expect(readoutChipMinWidth(1.3, 1.15)).toBe(Math.round(168 * 1.3 * 1.15));
  });
  it("grows its height with the system text size, not its padding", () => {
    expect(readoutChipHeight(40, 8, 1)).toBe(48);
    expect(readoutChipHeight(40, 8, 1.5)).toBe(68);
  });
});
