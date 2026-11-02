import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TAB_BADGE_STYLE } from "./tabBadgeStyle";

// At a large system font a one-line title became "38 pl..." and the More tab's
// count was clipped to "1...". Labels wrap; a badge is as tall as its text.
describe("large font scale", () => {
  // Mutation: `titleNumberOfLines = 1` and a title ellipsises beside its action.
  it("lets a Hero title wrap onto a second line by default", () => {
    const hero = readFileSync(new URL("./Hero.tsx", import.meta.url), "utf8");
    expect(hero).toMatch(/titleNumberOfLines = 2,/);
  });

  // Mutation: give the badge a `height` (React Navigation's own is a fixed 18
  // that clips scaled text) and this fails.
  it("sizes the tab badge from its text", () => {
    expect(TAB_BADGE_STYLE).toHaveProperty("height", undefined);
  });
});
