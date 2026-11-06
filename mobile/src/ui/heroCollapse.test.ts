import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STEP_PX,
  collapseRanges,
  compactHeroTitle,
  heroReach,
  roomBelow,
  rowTarget,
  snapTarget,
} from "./heroCollapseRule";

/** What an `Animated` interpolation with `extrapolate: "clamp"` returns. */
function at(ramp: { inputRange: number[]; outputRange: number[] }, y: number) {
  const { inputRange: x, outputRange: v } = ramp;
  if (y <= x[0]) return v[0];
  for (let i = 1; i < x.length; i++) {
    if (y <= x[i])
      return (
        v[i - 1] + ((y - x[i - 1]) / (x[i] - x[i - 1])) * (v[i] - v[i - 1])
      );
  }
  return v[v.length - 1];
}

const DISTANCE = 204;

describe("collapseRanges", () => {
  const r = collapseRanges(DISTANCE, false);
  // Mutation: change the slide's output to anything but -distance, and the
  // header and the rows under it stop moving together.
  it("slides the header exactly as far as the list scrolls, then holds", () => {
    expect(at(r.slide, 0)).toBe(0);
    expect(at(r.slide, 50)).toBe(-50);
    expect(at(r.slide, DISTANCE)).toBe(-DISTANCE);
    expect(at(r.slide, DISTANCE + 500)).toBe(-DISTANCE);
    expect(at(r.slide, -80)).toBe(0);
  });
  // Mutation: use +distance's sign for the slide, or drop the counter slide,
  // and the compact row travels up with the header and leaves the screen.
  it("keeps the compact row still: its slide cancels the header's", () => {
    for (const y of [0, 17, 100, DISTANCE, 900])
      expect(at(r.slide, y) + at(r.counterSlide, y)).toBeCloseTo(0);
  });
  // Mutation: let either opacity leave 0..1, or end the full hero's fade
  // after the compact row has already shown.
  it("fades the full hero out and the compact row in, never past 0..1", () => {
    expect(at(r.full, 0)).toBe(1);
    expect(at(r.compact, 0)).toBe(0);
    expect(at(r.full, DISTANCE)).toBe(0);
    expect(at(r.compact, DISTANCE)).toBe(1);
    for (let y = -50; y <= DISTANCE + 50; y += 7)
      for (const ramp of [r.full, r.compact]) {
        expect(at(ramp, y)).toBeGreaterThanOrEqual(0);
        expect(at(ramp, y)).toBeLessThanOrEqual(1);
      }
  });
  // Mutation: start the compact fade before the full one ends, or swap them:
  // there is a stretch with both rows faint and the header looks empty.
  it("crosses the two over the middle of the scroll", () => {
    const mid = DISTANCE / 2;
    expect(at(r.full, mid)).toBeLessThan(0.5);
    expect(at(r.compact, mid)).toBeLessThan(0.5);
    expect(at(r.full, mid) + at(r.compact, mid)).toBeGreaterThan(0.2);
  });
  // Mutation: let an input range repeat or descend, and the native driver
  // rejects the interpolation.
  it("hands the driver strictly rising input ranges", () => {
    for (const reduced of [false, true])
      for (const ramp of Object.values(collapseRanges(DISTANCE, reduced))) {
        expect(ramp.inputRange.length).toBe(ramp.outputRange.length);
        ramp.inputRange.forEach((x, i) => {
          if (i > 0) expect(x).toBeGreaterThan(ramp.inputRange[i - 1]);
        });
      }
  });
  // Mutation: return the animated ranges for a distance of 0 (hero not
  // measured yet) and the first frame divides by nothing.
  it("rests, full hero showing, until the hero has been measured", () => {
    const none = collapseRanges(0, false);
    for (const y of [0, 40, 400]) {
      expect(at(none.slide, y)).toBe(0);
      expect(at(none.full, y)).toBe(1);
      expect(at(none.compact, y)).toBe(0);
    }
  });
  // Mutation: use the normal ranges when motion is reduced, and the hero
  // slides and fades through every in-between frame.
  it("swaps in the last pixel when motion is reduced", () => {
    const still = collapseRanges(DISTANCE, true);
    const before = DISTANCE - STEP_PX - 0.01;
    for (const y of [0, 60, before]) {
      expect(at(still.slide, y)).toBe(0);
      expect(at(still.full, y)).toBe(1);
      expect(at(still.compact, y)).toBe(0);
    }
    expect(at(still.slide, DISTANCE)).toBe(-DISTANCE);
    expect(at(still.full, DISTANCE)).toBe(0);
    expect(at(still.compact, DISTANCE)).toBe(1);
  });
});

describe("snapTarget", () => {
  const list = { distance: DISTANCE };
  // Mutation: compare with `<=`, or snap to the nearer end the wrong way round.
  it("settles to the nearer end", () => {
    expect(snapTarget({ ...list, y: 20 })).toBe(0);
    expect(snapTarget({ ...list, y: DISTANCE / 2 - 1 })).toBe(0);
    expect(snapTarget({ ...list, y: DISTANCE / 2 })).toBe(DISTANCE);
    expect(snapTarget({ ...list, y: DISTANCE - 20 })).toBe(DISTANCE);
  });
  // Mutation: drop the `y <= 0 || y >= distance` guard, and a list at rest, or
  // scrolled far down, is yanked back to the collapsed offset.
  it("leaves a list at either end, or past it, where it is", () => {
    for (const y of [-30, 0, DISTANCE, DISTANCE + 1, 2500])
      expect(snapTarget({ ...list, y })).toBe(y);
  });
  // Mutation: remove the `distance > 0` guard, and an unmeasured hero snaps
  // every scroll to 0.
  it("does nothing before the hero is measured", () => {
    expect(snapTarget({ distance: 0, y: 40 })).toBe(40);
  });
});

describe("roomBelow", () => {
  const view = 800;
  // Mutation: return 0 when the overflow is under `distance` (the old rule sent
  // a user at the true bottom of a short list back to the top): the rows below
  // the fold are then out of reach once the header settles.
  it("gives a list that overflows by less than the collapse the room to scroll all of it", () => {
    const overflow = 60;
    const extra = roomBelow({
      contentHeight: view + overflow,
      viewHeight: view,
      distance: DISTANCE,
    });
    expect(extra).toBe(DISTANCE - overflow);
    // With the room added, the range is exactly the distance, so a list at its
    // true bottom is at or past the collapsed end and never snapped.
    const range = view + overflow + extra - view;
    expect(snapTarget({ y: range, distance: DISTANCE })).toBe(range);
  });
  // Mutation: make the answer depend on the room already added (the old
  // `contentHeight - extra` read, with `extra` the latest answer and the height
  // a layout behind): a list that overflows by 60 then asks for room, reads its
  // own padded height as overflow, drops the room, and asks again for as long
  // as it lays out.
  it("settles: the answer for a list's own height is the same on every read", () => {
    const own = view + 60;
    const first = roomBelow({
      contentHeight: own,
      viewHeight: view,
      distance: DISTANCE,
    });
    for (let read = 0; read < 5; read++)
      expect(
        roomBelow({ contentHeight: own, viewHeight: view, distance: DISTANCE }),
      ).toBe(first);
    expect(first).toBe(DISTANCE - 60);
  });
  // Mutation: drop the `overflow > 0.5` guard, and a list that fits scrolls.
  it("gives a list that fits, or a long one, nothing", () => {
    for (const contentHeight of [300, view, view + DISTANCE, 5000])
      expect(
        roomBelow({
          contentHeight,
          viewHeight: view,
          distance: DISTANCE,
        }),
      ).toBe(0);
    expect(
      roomBelow({
        contentHeight: 900,
        viewHeight: view,
        distance: 0,
      }),
    ).toBe(0);
  });
});

describe("heroReach", () => {
  // Mutation: gate on `collapsed` alone (drop `moving`), and the invisible full
  // hero takes the tap that was meant to stop a fling.
  it("lets neither form take touch while the list is moving", () => {
    for (const collapsed of [false, true])
      expect(heroReach({ collapsed, moving: true })).toEqual({
        full: false,
        compact: false,
      });
  });
  // Mutation: swap the two, and the folded form is the one that answers.
  it("at rest, only the form showing does", () => {
    expect(heroReach({ collapsed: false, moving: false })).toEqual({
      full: true,
      compact: false,
    });
    expect(heroReach({ collapsed: true, moving: false })).toEqual({
      full: false,
      compact: true,
    });
  });
});

describe("rowTarget", () => {
  const base = {
    header: 300,
    distance: DISTANCE,
    paddedFor: 300,
    gap: 16,
    range: 3000,
  };
  const folded = base.header - DISTANCE;
  // Mutation: drop the `folded` term, and the row lands a hero's height too low.
  it("puts the row a gap under the folded header", () => {
    expect(rowTarget({ ...base, contentY: 1000 })).toBe(1000 - folded - 16);
  });
  // Mutation: drop the null returns, and a row laid out before the header was
  // measured, or before the list was padded for it, scrolls to a short offset.
  it("waits for the header, and for the list to be padded for it", () => {
    expect(
      rowTarget({ ...base, contentY: 1000, header: 0, paddedFor: 0 }),
    ).toBeNull();
    expect(rowTarget({ ...base, contentY: 1000, paddedFor: 0 })).toBeNull();
  });
  // Mutation: drop the clamp to the range, or the snap, and the target is
  // past the end of the list or leaves the header half-folded.
  it("never leaves the header half-folded or the list past its end", () => {
    expect(rowTarget({ ...base, contentY: 1000, range: 600 })).toBe(600);
    expect(rowTarget({ ...base, contentY: 150 })).toBe(0);
    expect(rowTarget({ ...base, contentY: folded + 16 + 150 })).toBe(DISTANCE);
  });
});

describe("the hook", () => {
  const hook = readFileSync(
    new URL("./useHeroCollapse.ts", import.meta.url),
    "utf8",
  );
  // Mutation: set `useNativeDriver: false`, and the collapse silently runs
  // through the JS bridge again.
  it("feeds the scroll to the native driver", () => {
    expect(hook).toMatch(/Animated\.event\([\s\S]*useNativeDriver: true/);
    expect(hook).not.toContain("useNativeDriver: false");
  });
  // Mutation: bring `LayoutAnimation` back, and the swap lays the list out again.
  it("never animates layout", () => {
    expect(hook).not.toContain("LayoutAnimation");
    const header = readFileSync(
      new URL("./CollapsingHero.tsx", import.meta.url),
      "utf8",
    );
    expect(header).not.toContain("LayoutAnimation");
    expect(header).toContain("translateY");
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
// button, or add a screen with a `<Hero` to neither list below. Mutation: put
// a plain `FlatList`, `SectionList` or `ScrollView` back under the header, and
// the native driver never sees its scroll: the hero stops following it.
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
    expect(source).toContain("<CollapsingHeader collapse={heroCollapse}>");
    // A list that also pulls to refresh merges them (`mergeScrollProps`).
    expect(source).toMatch(
      /\{\.\.\.(heroCollapse\.scrollProps|mergeScrollProps\(heroCollapse\.scrollProps,)/,
    );
    expect(source).toContain("heroCollapse.inset(");
    // Saved has no pull to refresh.
    if (!file.includes("SavedScreen"))
      expect(source).toContain(
        "progressViewOffset={heroCollapse.headerHeight}",
      );
    expect(source).toMatch(/<Hero(FlatList|SectionList|ScrollView)\b/);
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
  // Mutation: move Saved's ChipRail back inside its ScrollView, or add
  // "buckets" back to Inbox's list-header keys, and the filter rail scrolls
  // away with the rows.
  it("pins the filter rail on Saved and Inbox", () => {
    const saved = readFileSync(
      new URL("../saved/SavedScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(saved.indexOf("<ChipRail")).toBeGreaterThan(-1);
    expect(saved.indexOf("<ChipRail")).toBeLessThan(
      saved.indexOf("<HeroScrollView"),
    );
    expect(saved.indexOf("<SearchField")).toBeLessThan(
      saved.indexOf("<HeroScrollView"),
    );
    const inbox = readFileSync(
      new URL("../screens/NotificationsScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(inbox).toMatch(
      /const headKeys: readonly string\[\] = \["truncated"\];/,
    );
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
