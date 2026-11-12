import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { tabBadgeLabel, tabBadgeStyle } from "./tabBadgeStyle";

// At a large system font a one-line title became "38 pl..." and the More tab's
// count was clipped to "1...". Labels wrap; a badge is as tall as its text.
describe("large font scale", () => {
  // Mutation: `titleNumberOfLines = 1` and a title ellipsises beside its action.
  it("lets a Hero title wrap onto a second line by default", () => {
    const hero = readFileSync(new URL("./Hero.tsx", import.meta.url), "utf8");
    expect(hero).toMatch(/titleNumberOfLines = 2,/);
  });

  // Mutation: delete the `tabBarBadgeStyle: tabBadgeStyle(` call from AppShell.tsx.
  it("applies the badge style to the More tab", () => {
    const shell = readFileSync(
      new URL("../AppShell.tsx", import.meta.url),
      "utf8",
    );
    expect(shell).toContain("tabBarBadgeStyle: tabBadgeStyle(");
  });

  // Mutation: give the badge a `height` (React Navigation's own is a fixed 18
  // that clips scaled text) and this fails.
  it("sizes the tab badge from its text", () => {
    expect(tabBadgeStyle("10", 1.5)).toHaveProperty("height", undefined);
  });

  // Mutation: return a fixed width, or ignore `fontScale`: "10" at 1.5x then
  // needs more than the pill has and is cut to "1…".
  it("gives a two-digit count at 1.5x more room than one digit at 1x", () => {
    const wide = tabBadgeStyle("10", 1.5).width as number;
    expect(wide).toBeGreaterThanOrEqual(2 * 14 * 1.5 * 0.65);
    expect(wide).toBeGreaterThan(tabBadgeStyle("1", 1).width as number);
    expect(tabBadgeStyle("10", 2).width).toBeGreaterThan(wide);
  });

  // Mutation: return `String(count)`, and a runaway count outgrows the bar.
  it("caps a count at 99+", () => {
    expect(tabBadgeLabel(7)).toBe("7");
    expect(tabBadgeLabel(100)).toBe("99+");
  });
});
