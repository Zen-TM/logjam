import { describe, expect, it } from "vitest";
import { parseTripPlanFormCreate } from "@logjam/shared";
import {
  adoptTheirs,
  formPatch,
  type FormValues,
  PLAN_FIELD_GROUPS,
  planPatch,
  sectionPatch,
  theirsChanged,
} from "./plansModel";

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
    expect(planPatch(plan, plan)).toEqual({});
    expect(planPatch(plan, { ...plan, endDate: null })).toEqual({
      dates: {
        from: { startDate: "2026-11-07", endDate: "2026-11-08" },
        to: { startDate: "2026-11-07", endDate: null },
      },
    });
    expect(planPatch(plan, { ...plan, name: "Wolgan", tripTypes: [] })).toEqual(
      {
        name: { from: "Wollangambe trip", to: "Wolgan" },
        tripTypes: { from: ["canyoning"], to: [] },
      },
    );
  });

  it("a section's title and text, each on its own", () => {
    const seen = { title: "Gear", body: "Wetsuit." };
    expect(sectionPatch(seen, { ...seen, body: "Wetsuit, helmet." })).toEqual({
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
    const { seen, values } = adoptTheirs(opened, mine, theirs);
    expect(values).toEqual({ ...theirs, name: "Wollangambe" });
    expect(planPatch(seen, values)).toEqual({
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
    const { seen, values } = adoptTheirs(
      opened,
      mine,
      theirs,
      PLAN_FIELD_GROUPS,
    );
    expect([values.startDate, values.endDate]).toEqual([
      "2026-11-07",
      "2026-11-09",
    ]);
    expect(planPatch(seen, values).dates).toEqual({
      from: { startDate: "2026-11-14", endDate: "2026-11-15" },
      to: { startDate: "2026-11-07", endDate: "2026-11-09" },
    });
    // Untouched, both follow the plan.
    const both = adoptTheirs(opened, opened, theirs, PLAN_FIELD_GROUPS);
    expect(both.values).toEqual(theirs);
  });

  // Mutation: drop the `current` against `opened` check in theirsChanged,
  // and "In the plan now" shows under a field only the user changed.
  it("says what the plan now holds only where both the user and the plan changed it", () => {
    const opened = { name: "Wollangambe trip", body: "Meet at 7." };
    const mine = { name: "Wollangambe", body: "Meet at 6." };
    const theirs = { name: "Wolly", body: "Meet at 7." };
    const { values } = adoptTheirs(opened, mine, theirs);
    expect(theirsChanged(opened, theirs, values, ["name"])).toBe(true);
    expect(theirsChanged(opened, theirs, values, ["body"])).toBe(false);
    // Untouched by the user, the field took theirs: nothing to show.
    const untouched = adoptTheirs(opened, opened, theirs).values;
    expect(theirsChanged(opened, theirs, untouched, ["name"])).toBe(false);
  });
});

describe("a form edit", () => {
  // As Postgres serves a JSONB column: keys sorted by length, then bytes.
  const served: FormValues = {
    title: "Carpooling",
    preset: "carpool",
    visibleTo: "members",
    requiredToJoin: false,
    questions: [
      {
        id: "how",
        help: "Pick one.",
        kind: "choice",
        label: "How are you getting there?",
        options: [
          { id: "drive", label: "Driving" },
          { id: "lift", label: "Need a lift" },
        ],
        required: true,
      },
    ],
  };
  const parsed = (values: FormValues) => {
    const result = parseTripPlanFormCreate(values);
    if (!("value" in result)) throw new Error("the fixture must parse");
    return { ...values, ...result.value } as FormValues;
  };

  // Mutation: compare the questions with a raw `JSON.stringify`, and Save
  // with nothing changed writes them, so everyone's answer dialog gets a 409.
  it("sends nothing for a served form saved unchanged, and only the title for a title edit", () => {
    expect(formPatch(served, parsed(served))).toEqual({});
    expect(formPatch(served, parsed({ ...served, title: "Lifts" }))).toEqual({
      title: { from: "Carpooling", to: "Lifts" },
    });
  });

  // Mutation: re-base `seen` on theirs but keep every value as it was, and
  // the save sends the old title and questions back over the other leader's.
  it("takes another leader's rename and question when the leader changed only who sees answers", () => {
    const mine = { ...served, visibleTo: "leaders" as const };
    const theirs: FormValues = {
      ...served,
      title: "Lifts",
      questions: [
        ...served.questions,
        { id: "seats", kind: "number", label: "Spare seats", required: false },
      ],
    };
    const { seen, values } = adoptTheirs(served, mine, theirs);
    expect(formPatch(seen, values)).toEqual({
      visibleTo: { from: "members", to: "leaders" },
    });
  });
});
