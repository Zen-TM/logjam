import { describe, expect, it } from "vitest";
import {
  TRIP_PLAN_FIELD_GROUPS,
  tripPlanAdoptTheirs,
  tripPlanPatch,
  tripPlanSectionPatch,
  tripPlanTheirsChanged,
} from "./tripPlanEdits.js";

const plan = {
  name: "Wollangambe trip",
  startDate: "2026-11-07",
  endDate: "2026-11-08",
  tripTypes: ["canyoning"],
};

describe("an edit sends only what changed, with what it last saw", () => {
  // Mutation: send every field (`patch = { name: …, dates: …, tripTypes: … }`
  // always) and a save over someone else's change of another field is refused.
  it("a plan's fields", () => {
    expect(tripPlanPatch(plan, plan)).toEqual({});
    expect(tripPlanPatch(plan, { ...plan, endDate: null })).toEqual({
      dates: {
        from: { startDate: "2026-11-07", endDate: "2026-11-08" },
        to: { startDate: "2026-11-07", endDate: null },
      },
    });
    expect(
      tripPlanPatch(plan, { ...plan, name: "Wolgan", tripTypes: [] }),
    ).toEqual({
      name: { from: "Wollangambe trip", to: "Wolgan" },
      tripTypes: { from: ["canyoning"], to: [] },
    });
  });

  it("a section's title and text, each on its own", () => {
    const seen = { title: "Gear", body: "Wetsuit." };
    expect(
      tripPlanSectionPatch(seen, { ...seen, body: "Wetsuit, helmet." }),
    ).toEqual({
      body: { from: "Wetsuit.", to: "Wetsuit, helmet." },
    });
  });
});

describe("a form refetched under the user", () => {
  // Mutation: keep `values` as they were (drop the merge), and saving again
  // sends the untouched dates back over the other member's change.
  it("takes their change in every field the user did not touch, and sends only the user's", () => {
    const opened = {
      name: "Wollangambe trip",
      startDate: "2026-11-07",
      endDate: "2026-11-08",
      tripTypes: [],
    };
    const mine = { ...opened, name: "Wollangambe" };
    const theirs = { ...opened, name: "Wolly", startDate: "2026-11-14" };
    const { seen, values } = tripPlanAdoptTheirs(opened, mine, theirs);
    expect(values).toEqual({ ...theirs, name: "Wollangambe" });
    expect(tripPlanPatch(seen, values)).toEqual({
      name: { from: "Wolly", to: "Wollangambe" },
    });
  });

  // Mutation: adopt each date on its own, and the untouched start takes
  // theirs while the end keeps mine: 14 Nov to 9 Nov, which nobody chose.
  it("keeps both of the user's dates when they changed one", () => {
    const opened = { ...plan };
    const mine = { ...opened, endDate: "2026-11-09" };
    const theirs = {
      ...opened,
      startDate: "2026-11-14",
      endDate: "2026-11-15",
    };
    const { seen, values } = tripPlanAdoptTheirs(
      opened,
      mine,
      theirs,
      TRIP_PLAN_FIELD_GROUPS,
    );
    expect([values.startDate, values.endDate]).toEqual([
      "2026-11-07",
      "2026-11-09",
    ]);
    expect(tripPlanPatch(seen, values).dates).toEqual({
      from: { startDate: "2026-11-14", endDate: "2026-11-15" },
      to: { startDate: "2026-11-07", endDate: "2026-11-09" },
    });
    // Untouched, both follow the plan.
    const both = tripPlanAdoptTheirs(
      opened,
      opened,
      theirs,
      TRIP_PLAN_FIELD_GROUPS,
    );
    expect(both.values).toEqual(theirs);
  });
});

describe("tripPlanTheirsChanged", () => {
  const opened = { title: "Access", body: "Gate" };
  // Mutation: drop the `opened` comparison. Every edited field would claim
  // the plan changed it.
  it("is true only for an edited field the plan changed", () => {
    const current = { title: "Access", body: "Bob's" };
    const mine = { title: "Access", body: "Ann's" };
    expect(tripPlanTheirsChanged(["body"], mine, current, opened)).toBe(true);
    expect(tripPlanTheirsChanged(["title"], mine, current, opened)).toBe(false);
    // Edited, but the plan still holds what the form opened with.
    expect(tripPlanTheirsChanged(["body"], mine, opened, opened)).toBe(false);
    // The plan changed it, but the user didn't touch it: it follows.
    expect(tripPlanTheirsChanged(["body"], current, current, opened)).toBe(
      false,
    );
  });
});
