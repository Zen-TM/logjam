import { describe, expect, it } from "vitest";
import {
  tripPlanAdoptTheirs,
  tripPlanPatch,
  tripPlanSectionPatch,
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
});
