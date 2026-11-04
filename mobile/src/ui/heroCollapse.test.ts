import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

// Every top-level list page pins a hero that gives way to the compact row once
// the list scrolls (shared/DESIGN.md §2). Mutation: drop the `CollapsingHero` or the
// `scrollProps` spread from one screen, re-literal a compact title or add
// button, or add a screen with a `<Hero` to neither list below.
const COLLAPSING = [
  "../places/PlacesScreen.tsx",
  "../logs/LogsScreen.tsx",
  "../saved/SavedScreen.tsx",
  "../screens/NotificationsScreen.tsx",
  "../plans/PlansScreen.tsx",
  "../screens/FriendsScreen.tsx",
  "../screens/LeaderboardScreen.tsx",
];
// A detail page's header is the item itself, and a flow or a short menu has
// nothing long to scroll under its hero.
const KEEPS_FULL_HERO = [
  "../map/RegionDownloadScreen.tsx",
  "../plans/PlanScreen.tsx",
  "../plans/PlanPreview.tsx",
  "../places/PlaceDetailScreen.tsx",
  "../logs/TripDetailScreen.tsx",
  "../logs/StatsScreen.tsx",
  "../sharing/FriendSharesScreen.tsx",
  "../screens/MoreScreen.tsx",
  "../screens/AccountScreen.tsx",
  "../screens/SyncIssuesScreen.tsx",
];

describe("list screens collapse their hero", () => {
  it.each(COLLAPSING)("%s", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain("<CollapsingHero collapse={heroCollapse}>");
    expect(source).toContain("{...heroCollapse.scrollProps}");
    expect(source).toContain("compact={compact}");
    expect(source).not.toMatch(/`[^`]*\$\{[^}]*\.length[^}]*\}`\s*:/);
  });
  // Mutation: put a compact title back to the bare name ("Saved", "Inbox"), or
  // drop an add's compact form, and the pinned row stops saying how many.
  it.each([
    "../places/PlacesScreen.tsx",
    "../logs/LogsScreen.tsx",
    "../plans/PlansScreen.tsx",
    "../screens/FriendsScreen.tsx",
    "../saved/SavedScreen.tsx",
    "../screens/NotificationsScreen.tsx",
  ])("%s says its count in the compact row", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain("compactHeroTitle(");
  });
  it.each([
    "../places/PlacesScreen.tsx",
    "../logs/LogsScreen.tsx",
    "../plans/PlansScreen.tsx",
    "../screens/FriendsScreen.tsx",
  ])("%s draws its add through HeroAdd", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain("<HeroAdd");
  });
  it("Leaderboard's compact row says the standing", () => {
    const source = readFileSync(
      new URL("../screens/LeaderboardScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("`${LEADERBOARD.title} · ${standing}`");
  });
  it("sorts every screen that draws a Hero", () => {
    const dir = fileURLToPath(new URL("..", import.meta.url));
    const known = new Set(
      [...COLLAPSING, ...KEEPS_FULL_HERO].map((file) =>
        fileURLToPath(new URL(file, import.meta.url)),
      ),
    );
    const drawn = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => /Screen\.tsx$|PlanPreview\.tsx$/.test(file))
      .map((file) => join(dir, file))
      .filter((file) => /<Hero[\s>]/.test(readFileSync(file, "utf8")));
    expect(drawn.filter((file) => !known.has(file))).toEqual([]);
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
