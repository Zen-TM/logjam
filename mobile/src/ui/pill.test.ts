import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BADGE_SIZE, halfRadius } from "./pill";

describe("the chip's count badge", () => {
  it("is a circle at one digit: radius exactly half its box", () => {
    expect(halfRadius(BADGE_SIZE)).toBe(BADGE_SIZE / 2);
  });

  // Red when the badge goes back to `radius.pill` (999): RN Android then draws
  // it square after another chip is selected. To see it: put
  // `borderRadius: radius.pill` back in Chip.tsx's `badge` style.
  it("takes its radius from halfRadius, never radius.pill", () => {
    const source = readFileSync(new URL("./Chip.tsx", import.meta.url), "utf8");
    const badge = source.slice(
      source.indexOf("  badge: {"),
      source.indexOf("  // No wash on a fill"),
    );
    expect(badge).toContain("halfRadius(BADGE_SIZE)");
    expect(badge).not.toContain("radius.pill");
  });

  // Red when the badge stops remounting as its chip flips: a half radius alone
  // still came back squarish on the emulator once another chip was selected.
  // To see it: delete the `key={active ? "on" : "off"}` line in Chip.tsx.
  it("is remounted when its chip flips between active and not", () => {
    const source = readFileSync(new URL("./Chip.tsx", import.meta.url), "utf8");
    expect(source).toContain('key={active ? "on" : "off"}');
  });
});

// A pill-shaped control is never narrower than it is tall (`minWidth` = its
// height), so a one-glyph or one-digit pill is a circle. To see it red: delete
// the `minWidth` line from the style named below.
describe("a pill is never narrower than it is tall", () => {
  const rule: [string, RegExp][] = [
    ["Chip.tsx", /minHeight: CHIP_HEIGHT,[\s\S]*?minWidth: CHIP_HEIGHT/],
    ["StatusPill.tsx", /minHeight: PILL_HEIGHT,\s*minWidth: PILL_HEIGHT/],
    [
      "Button.tsx",
      /minHeight: controlSize\.lg,[\s\S]*?minWidth: controlSize\.lg/,
    ],
    ["Button.tsx", /minHeight: controlSize\.md,\s*minWidth: controlSize\.md/],
  ];
  it.each(rule)("%s", (file, pattern) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(source).toMatch(pattern);
  });
});
