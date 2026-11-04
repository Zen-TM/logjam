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

const GIVES = list.fullHeight - list.compactHeight;

describe("nextCompact", () => {
  // Mutation: remove the `gives` term and the short list below collapses.
  it("never collapses a list that would stop scrolling once the hero shrinks", () => {
    const short = { ...list, contentHeight: 800 + GIVES + 20 };
    expect(nextCompact({ ...short, compact: false, y: 400 })).toBe(false);
    expect(nextCompact({ ...list, compact: false, y: 400 })).toBe(true);
  });
  // Mutation: swap the two thresholds, compare with `<` instead of `>`, or
  // drop `gives` from the collapse line (the old logic: collapse at 32).
  it("collapses past what the hero gives plus COLLAPSE_AT, holds between, and expands at EXPAND_AT", () => {
    const line = GIVES + COLLAPSE_AT;
    expect(nextCompact({ ...list, compact: false, y: line })).toBe(false);
    expect(nextCompact({ ...list, compact: false, y: line + 1 })).toBe(true);
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

// The swap changes the list's height, and the platform moves the offset to
// match: it clamps it by what the hero gave up, and may add it back when the
// hero returns. A scroll that goes one way must swap once, whatever the offset
// does at the swap. Mutation: collapse at COLLAPSE_AT alone, or expand above
// EXPAND_AT, and the "follow" model flaps (full, compact, full, compact).
describe("a swipe swaps the hero exactly once", () => {
  // What the swap itself does to the offset, per platform behaviour.
  const MODELS = {
    // The rows stay where they were on screen: the offset moves by `gives`.
    follow: (y: number, gives: number, nowCompact: boolean) =>
      nowCompact ? Math.max(0, y - gives) : y + gives,
    // The offset is left alone.
    keep: (y: number) => y,
    // Only a collapse moves it (a clamp to the new, shorter maximum).
    clamp: (y: number, gives: number, nowCompact: boolean) =>
      nowCompact ? Math.max(0, y - gives) : y,
  };

  function swipe(
    model: keyof typeof MODELS,
    fullHeight: number,
    from: { y: number; compact: boolean },
    step: number,
  ) {
    const gives = fullHeight - list.compactHeight;
    let { y, compact } = from;
    const swaps: boolean[] = [];
    for (let frame = 0; frame < 400; frame++) {
      y = Math.max(0, y + step);
      // The swap's own scroll event arrives before the finger moves again.
      for (let settle = 0; settle < 4; settle++) {
        const next = nextCompact({
          compact,
          y,
          contentHeight: list.contentHeight,
          viewHeight: list.viewHeight + (compact ? gives : 0),
          fullHeight,
          compactHeight: list.compactHeight,
        });
        if (next === compact) break;
        compact = next;
        swaps.push(next);
        y = MODELS[model](y, gives, next);
      }
    }
    return swaps;
  }

  const heroes = [120, 260, 380];
  for (const model of Object.keys(MODELS) as (keyof typeof MODELS)[]) {
    for (const fullHeight of heroes) {
      it(`up, then down: collapse once, expand once (${model}, hero ${fullHeight})`, () => {
        expect(swipe(model, fullHeight, { y: 0, compact: false }, 6)).toEqual([
          true,
        ]);
        expect(
          swipe(model, fullHeight, { y: 2400, compact: true }, -6),
        ).toEqual([false]);
      });
    }
  }
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
