import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CHROME_GAP, FAB_SIZE } from "./mapChrome";
import {
  readoutChipHeight,
  readoutChipLayout,
  readoutChipMinWidth,
} from "./readoutChipSize";

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
    expect(source).toContain("{ minWidth: width }");
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

// Mutation: return `wanted` from `readoutChipLayout` unclamped (the chip then
// grows to 336 at 2.0 and covers the Locate button), or report `stacked` false
// when it was clamped (the columns are squeezed to a half-width each and the
// figures are cut).
describe("the chip never reaches the action column", () => {
  // The map leaves the chip what the scale bar gets (MapScreen's
  // `scaleBarMaxWidth`), on the narrowest and a wide phone.
  const maxOf = (windowWidth: number) =>
    windowWidth - FAB_SIZE - CHROME_GAP * 3 - 8;
  it("fits its room at every system text size to the OS maximum", () => {
    for (const windowWidth of [320, 360, 412])
      for (const textScale of [0.85, 1, 1.15, 1.3])
        for (const fontScale of [0.85, 1, 1.3, 1.5, 1.8, 2, 2.6])
          expect(
            readoutChipLayout(fontScale, textScale, maxOf(windowWidth)).width,
          ).toBeLessThanOrEqual(maxOf(windowWidth));
  });
  it("stacks the readings exactly when the wanted width does not fit", () => {
    expect(readoutChipLayout(1, 1, 260)).toEqual({
      width: 168,
      stacked: false,
    });
    expect(readoutChipLayout(2, 1, 260)).toEqual({ width: 260, stacked: true });
    expect(readoutChipHeight(40, 8, 2, true)).toBe(168);
  });
});

// Stacked, the chip is two label/figure pairs and nothing else: it sizes to its
// content and reports what it drew. Mutation: give the stacked column back
// `flex: 1` (each half then took several times its text on the S9 at 2.0 and
// covered the compass strip and scale bar), or drop `onLayout`/`onHeight` (the
// ornament margin reverts to an estimate).
describe("the stacked chip is only as tall as its content", () => {
  const source = readFileSync(
    new URL("./SpeedElevationChip.tsx", import.meta.url),
    "utf8",
  ).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
  it("does not let a stacked column grow", () => {
    const stacked = source.match(/columnStacked: \{([^}]*)\}/)?.[1] ?? "";
    expect(stacked).toContain("flexGrow: 0");
    expect(stacked).toContain('flexBasis: "auto"');
    expect(stacked).not.toMatch(/\bflex: 1/);
    expect(source.match(/stacked && styles\.columnStacked/g)).toHaveLength(2);
  });
  it("reports its measured height", () => {
    expect(source).toContain("onLayout={(e) => onHeight(");
  });
  // Mutation: count the lines twice again (`* 2` on top of the stacking).
  it("estimates two pairs of lines, no more", () => {
    // 2.0x: two pairs of (40 * 2) line height, plus the padding.
    expect(readoutChipHeight(40, 8, 2, true)).toBe(2 * 40 * 2 + 8);
    expect(readoutChipHeight(40, 8, 2, true)).toBeLessThan(
      2 * readoutChipHeight(40, 8, 2, false),
    );
  });
});
