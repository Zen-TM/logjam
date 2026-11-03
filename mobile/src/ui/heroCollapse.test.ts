import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COLLAPSE_AT,
  EXPAND_AT,
  compactHeroTitle,
  nextCompact,
} from "./heroCollapseRule";

const list = {
  contentHeight: 3000,
  viewHeight: 800,
  fullHeight: 260,
  compactHeight: 56,
};

describe("nextCompact", () => {
  // Mutation: remove the `gives` term and the short list below collapses.
  it("never collapses a list that would stop scrolling once the hero shrinks", () => {
    const short = { ...list, contentHeight: 800 + 204 + 20 };
    expect(nextCompact({ ...short, compact: false, y: 200 })).toBe(false);
    expect(nextCompact({ ...list, compact: false, y: 200 })).toBe(true);
  });
  // Mutation: swap the two thresholds, or compare with `<` instead of `>`.
  it("collapses past COLLAPSE_AT, holds between, and expands at EXPAND_AT", () => {
    expect(nextCompact({ ...list, compact: false, y: COLLAPSE_AT })).toBe(
      false,
    );
    expect(nextCompact({ ...list, compact: false, y: COLLAPSE_AT + 1 })).toBe(
      true,
    );
    expect(nextCompact({ ...list, compact: true, y: EXPAND_AT + 1 })).toBe(
      true,
    );
    expect(nextCompact({ ...list, compact: true, y: EXPAND_AT })).toBe(false);
  });
  // Mutation: drop the `overflow <= 0` term, and a search that shortens a
  // scrolled list leaves the compact row with nothing to scroll back with.
  it("expands when a compact list no longer overflows its view", () => {
    expect(
      nextCompact({ ...list, compact: true, y: 100, contentHeight: 700 }),
    ).toBe(false);
  });
});

describe("compactHeroTitle", () => {
  it("says the name, then the count", () => {
    expect(compactHeroTitle("Places", 36)).toBe("Places · 36");
  });
});

// The four long lists pin a hero that gives way to the compact row once the
// list scrolls. Mutation: drop `compact={heroCollapse.compact}` or a spread
// from one screen; re-literal a compact title or add button.
describe("list screens collapse their hero", () => {
  it.each([
    "../places/PlacesScreen.tsx",
    "../logs/LogsScreen.tsx",
    "../screens/FriendsScreen.tsx",
    "../plans/PlansScreen.tsx",
  ])("%s", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain("compact={heroCollapse.compact}");
    expect(source).toContain("{...heroCollapse.scrollProps}");
    expect(source).toContain("{...heroCollapse.heroProps}");
    expect(source).toContain("compactHeroTitle(");
    expect(source).toContain("<HeroAdd");
    expect(source).not.toMatch(/`[^`]*\$\{[^}]*\.length[^}]*\}`\s*:/);
  });
  it("seeds the tray's Add a place from the map's camera", () => {
    const source = readFileSync(
      new URL("../map/MapScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /if \(tool === "place"\) \{[^}]*setAddPlaceAt\(\{\s*latitude: camera\.latitude,\s*longitude: camera\.longitude,?\s*\}\)/,
    );
  });
});
