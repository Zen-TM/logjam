import { describe, expect, it } from "vitest";
import {
  TRIP_PLAN_FIELD_GROUPS,
  tripPlanAdoptTheirs,
  tripPlanBlankForm,
  tripPlanFormPatch,
  tripPlanMintSlug,
  tripPlanQuestionKindChanged,
  tripPlanPatch,
  tripPlanSame,
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

describe("a form's edits", () => {
  const form = {
    title: "Gear",
    preset: null,
    visibleTo: "leaders" as const,
    questions: [
      { id: "q1", kind: "text" as const, label: "Boots", required: false },
    ],
  };

  // Mutation: compare questions by length and an edited label is never sent.
  it("sends only the changed parts, the questions as one list", () => {
    expect(tripPlanFormPatch(form, form)).toEqual({});
    const questions = [{ ...form.questions[0], label: "Boot size" }];
    expect(
      tripPlanFormPatch(form, { ...form, title: "Kit", questions }),
    ).toEqual({
      title: { from: "Gear", to: "Kit" },
      questions: { from: form.questions, to: questions },
    });
    expect(tripPlanFormPatch(form, { ...form, visibleTo: "members" })).toEqual({
      visibleTo: { from: "leaders", to: "members" },
    });
  });

  // Mutation: compare the questions with a raw `JSON.stringify`, and Save
  // with nothing changed writes them, so everyone's answer dialog gets a 409.
  it("reads a question list Postgres returned with its keys in another order", () => {
    const served = [
      {
        required: true,
        label: "How?",
        kind: "choice" as const,
        id: "how",
        options: [{ label: "Driving", id: "drive" }],
      },
    ];
    const sent = [
      {
        id: "how",
        kind: "choice" as const,
        label: "How?",
        required: true,
        options: [{ id: "drive", label: "Driving" }],
      },
    ];
    expect(tripPlanSame(served, sent)).toBe(true);
    expect(
      tripPlanFormPatch(
        { ...form, questions: served },
        { ...form, questions: sent },
      ),
    ).toEqual({});
  });

  // Mutation: re-base `seen` on theirs but keep every value as it was, and
  // the save sends the old title and questions back over the other leader's.
  it("takes another leader's rename and question when the leader changed only who sees answers", () => {
    const theirs = {
      ...form,
      title: "Lifts",
      questions: [
        ...form.questions,
        {
          id: "seats",
          kind: "number" as const,
          label: "Spare seats",
          required: false,
        },
      ],
    };
    const mine = { ...form, visibleTo: "members" as const };
    const { seen, values } = tripPlanAdoptTheirs(form, mine, theirs);
    expect(tripPlanFormPatch(seen, values)).toEqual({
      visibleTo: { from: "leaders", to: "members" },
    });
  });

  it("mints slugs the API accepts", () => {
    expect(tripPlanMintSlug("q")).toMatch(/^q[a-z0-9]{8,12}$/);
    expect(tripPlanMintSlug("o", () => 0)).toMatch(/^o0+$/);
  });

  // Mutation: keep `options` on a kind without them.
  it("gives a choice two options and any other kind none", () => {
    const choice = tripPlanQuestionKindChanged(form.questions[0], "choice");
    expect(choice.options).toHaveLength(2);
    expect(new Set(choice.options!.map((o) => o.id)).size).toBe(2);
    expect(tripPlanQuestionKindChanged(choice, "multiChoice").options).toBe(
      choice.options,
    );
    expect("options" in tripPlanQuestionKindChanged(choice, "text")).toBe(
      false,
    );
  });

  it("starts a blank form the API accepts once titled", () => {
    const blank = tripPlanBlankForm();
    expect(blank.questions).toHaveLength(1);
    expect(blank.visibleTo).toBe("leaders");
  });
});
