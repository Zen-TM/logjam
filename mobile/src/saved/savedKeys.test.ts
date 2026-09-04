import { describe, expect, it } from "vitest";

import { CATEGORY_SYNCS, SAVED_CATEGORIES } from "./savedKeys";

describe("the sync boundary", () => {
  it("answers for every category — a new kind cannot join without deciding", () => {
    for (const category of SAVED_CATEGORIES) {
      expect(typeof CATEGORY_SYNCS[category]).toBe("boolean");
    }
    expect(Object.keys(CATEGORY_SYNCS).sort()).toEqual([...SAVED_CATEGORIES].sort());
  });

  it("splits on what the user MADE versus what they downloaded", () => {
    // The sentence the Saved tab shows, as an assertion. If a change here is
    // deliberate, the hero copy in SavedScreen.tsx has to move with it —
    // the screen states this rule in words and would otherwise start lying.
    const synced = SAVED_CATEGORIES.filter((c) => CATEGORY_SYNCS[c]);
    const deviceOnly = SAVED_CATEGORIES.filter((c) => !CATEGORY_SYNCS[c]);
    expect(synced.sort()).toEqual(["import", "route", "track", "waypoint"]);
    expect(deviceOnly.sort()).toEqual(["geoPdf", "overlay", "region"]);
  });
});
