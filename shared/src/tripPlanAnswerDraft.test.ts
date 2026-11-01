import { describe, expect, it } from "vitest";
import {
  answersFromDraft,
  draftFromAnswers,
  fitAnswerDraft,
  joinAnswers,
} from "./tripPlanAnswerDraft.js";
import { TRIP_PLAN_FORM_PRESETS, type TripPlanQuestion } from "./tripPlans.js";

const questions: TripPlanQuestion[] = [
  { id: "seats", kind: "number", label: "Seats", required: false },
  { id: "swim", kind: "yesNo", label: "Swim", required: true },
  { id: "rules", kind: "agree", label: "Rules", required: false },
  { id: "notes", kind: "text", label: "Notes", required: false },
];

describe("a form being filled in", () => {
  it("round-trips an answer through the controls", () => {
    const answers = { seats: 3, swim: false, rules: true, notes: "Late" };
    const draft = draftFromAnswers(questions, answers);
    expect(draft).toEqual({
      seats: "3",
      swim: "false",
      rules: true,
      notes: "Late",
    });
    expect(answersFromDraft(questions, draft)).toEqual(answers);
  });

  // Mutation: drop the `""` skip, and an empty optional number field goes
  // as "" and the parser refuses the whole form.
  it("sends nothing for an empty control", () => {
    expect(
      answersFromDraft(questions, { seats: "", rules: false, notes: "" }),
    ).toEqual({});
  });
});

describe("a draft after the form changed under it", () => {
  const gear: TripPlanQuestion = {
    id: "gear",
    kind: "multiChoice",
    label: "Gear",
    required: false,
    options: [
      { id: "rope", label: "Rope" },
      { id: "helmet", label: "Helmet" },
    ],
  };

  it("keeps the ticks whose options are still there", () => {
    const now = { ...gear, options: [{ id: "helmet", label: "Helmet" }] };
    expect(fitAnswerDraft([gear], [now], { gear: ["rope", "helmet"] })).toEqual(
      {
        gear: ["helmet"],
      },
    );
  });

  // Mutation: coerce by the new kind (`value === "true"`), and "Late" under
  // a question now yes or no is stored as No, an answer nobody gave.
  it("drops an answer that no longer fits its question, never turns it into another", () => {
    const now: TripPlanQuestion[] = [
      { id: "notes", kind: "yesNo", label: "Notes", required: false },
      { id: "seats", kind: "number", label: "Seats", required: false },
    ];
    expect(
      fitAnswerDraft(questions, now, { notes: "Late", seats: "two" }),
    ).toEqual({});
    expect(answersFromDraft(now, { notes: "Late" })).toEqual({
      notes: "Late",
    });
  });

  // Mutation: fit with the new questions only, and the text box holds
  // "false" or an option's id, stored as an answer nobody gave.
  it("drops an answer whose question became text", () => {
    const pick = {
      id: "car",
      kind: "choice",
      label: "Car",
      required: false,
      options: [{ id: "o_k3j2", label: "Mine" }],
    } as TripPlanQuestion;
    const was = [questions[1], pick];
    const now = was.map((question) => ({ ...question, kind: "text" as const }));
    expect(fitAnswerDraft(was, now, { swim: "false", car: "o_k3j2" })).toEqual(
      {},
    );
    // Unchanged, the answers stay.
    expect(fitAnswerDraft(was, was, { swim: "false", car: "o_k3j2" })).toEqual({
      swim: "false",
      car: "o_k3j2",
    });
  });

  it("drops the answer to a question that went", () => {
    expect(
      fitAnswerDraft(questions, [questions[0]], {
        seats: "2",
        notes: "x",
      }),
    ).toEqual({
      seats: "2",
    });
  });
});
