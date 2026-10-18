import { describe, expect, it } from "vitest";
import {
  TRIP_PLAN_FORM_PRESETS,
  TRIP_PLAN_FORM_PRESET_IDS,
  TRIP_PLAN_MAX_QUESTIONS,
  currentTripPlanAnswers,
  isDateOnly,
  parseTripPlanAnswers,
  parseTripPlanCreate,
  parseTripPlanFormCreate,
  parseTripPlanFormPatch,
  parseTripPlanOrder,
  parseTripPlanPatch,
  parseTripPlanSectionCreate,
  parseTripPlanSectionPatch,
  parseTripTypeList,
  type TripPlanParsed,
  type TripPlanQuestion,
} from "./tripPlans.js";
import { apiSentenceViolations } from "./copyRules.js";

function value<T>(parsed: TripPlanParsed<T>): T {
  if (!("value" in parsed)) throw new Error(JSON.stringify(parsed));
  return parsed.value;
}
const sentence = (parsed: TripPlanParsed<unknown>) =>
  "sentence" in parsed ? parsed.sentence : undefined;
const isMalformed = (parsed: TripPlanParsed<unknown>) => "malformed" in parsed;

describe("plan create", () => {
  it("trims the name and fills the defaults", () => {
    expect(value(parseTripPlanCreate({ name: "  Wollangambe  " }))).toEqual({
      name: "Wollangambe",
      startDate: null,
      endDate: null,
      tripTypes: [],
    });
  });

  it("refuses an empty name, an end before the start, a doubled type", () => {
    expect(sentence(parseTripPlanCreate({ name: " " }))).toBe(
      "Give the plan a name.",
    );
    expect(
      sentence(
        parseTripPlanCreate({
          name: "x",
          startDate: "2026-11-09",
          endDate: "2026-11-08",
        }),
      ),
    ).toBe("The trip can't end before it starts.");
    expect(
      sentence(parseTripPlanCreate({ name: "x", tripTypes: ["A", "a"] })),
    ).toMatch(/same type twice/);
  });

  it("takes only real calendar days", () => {
    expect(isDateOnly("2026-02-28")).toBe(true);
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-2-3")).toBe(false);
    expect(
      isMalformed(parseTripPlanCreate({ name: "x", startDate: "soon" })),
    ).toBe(true);
  });
});

describe("trip types", () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);

  // api/AGENTS.md: an array over its cap is 413. Mutation: drop the 413 from
  // tripTypes()'s cap, or the cap on tripTypes.from.
  it("refuses a list over the cap with 413, on create and on both sides of a patch", () => {
    expect(parseTripPlanCreate({ name: "x", tripTypes: eleven })).toMatchObject(
      {
        status: 413,
      },
    );
    expect(
      parseTripPlanPatch({ tripTypes: { from: [], to: eleven } }),
    ).toMatchObject({ status: 413 });
    expect(
      parseTripPlanPatch({ tripTypes: { from: eleven, to: [] } }),
    ).toMatchObject({
      status: 413,
      malformed: "tripTypes.from is over the cap",
    });
  });

  it("names the list in a malformed detail", () => {
    expect(parseTripTypeList("x", "types")).toEqual({
      malformed: "types must be an array of strings",
    });
    expect(value(parseTripTypeList([" A ", "b"], "types"))).toEqual(["A", "b"]);
  });
});

describe("compare-and-set patches", () => {
  it("checks `to` with the create rules and `from` for shape only", () => {
    // A `from` of "" is a name the client saw before trimming rules: still
    // compared, never refused.
    expect(
      value(parseTripPlanPatch({ name: { from: "", to: " New " } })),
    ).toEqual({ name: { from: "", to: "New" } });
    expect(sentence(parseTripPlanPatch({ name: { from: "a", to: "" } }))).toBe(
      "Give the plan a name.",
    );
    expect(isMalformed(parseTripPlanPatch({ name: { to: "x" } }))).toBe(true);
    expect(isMalformed(parseTripPlanPatch({}))).toBe(true);
  });

  it("moves both dates together", () => {
    expect(
      value(
        parseTripPlanPatch({
          dates: {
            from: { startDate: null, endDate: null },
            to: { startDate: "2026-11-08", endDate: null },
          },
        }),
      ).dates,
    ).toEqual({
      from: { startDate: null, endDate: null },
      to: { startDate: "2026-11-08", endDate: null },
    });
  });

  it("patches sections and forms field by field", () => {
    expect(
      value(parseTripPlanSectionPatch({ body: { from: "a", to: "b\n\n" } })),
    ).toEqual({ body: { from: "a", to: "b" } });
    expect(
      value(
        parseTripPlanFormPatch({
          visibleTo: { from: "leaders", to: "members" },
        }),
      ),
    ).toEqual({ visibleTo: { from: "leaders", to: "members" } });
    expect(
      isMalformed(
        parseTripPlanFormPatch({ visibleTo: { from: "leaders", to: "all" } }),
      ),
    ).toBe(true);
  });
});

describe("order", () => {
  it("wants every id once, capped at both ends", () => {
    expect(value(parseTripPlanOrder({ ids: ["a", "b"] }, 3))).toEqual([
      "a",
      "b",
    ]);
    expect(isMalformed(parseTripPlanOrder({ ids: [] }, 3))).toBe(true);
    expect(isMalformed(parseTripPlanOrder({ ids: ["a", "a"] }, 3))).toBe(true);
    expect(parseTripPlanOrder({ ids: ["a", "b"] }, 1)).toMatchObject({
      status: 413,
    });
  });
});

describe("forms", () => {
  it("every preset is a form its own validator accepts, unchanged", () => {
    for (const id of TRIP_PLAN_FORM_PRESET_IDS) {
      const preset = TRIP_PLAN_FORM_PRESETS[id];
      expect(preset.preset).toBe(id);
      expect(value(parseTripPlanFormCreate(preset))).toEqual(preset);
    }
  });

  it("drops options from a kind that has none, and refuses a choice without two", () => {
    const form = value(
      parseTripPlanFormCreate({
        title: "T",
        visibleTo: "leaders",
        requiredToJoin: false,
        questions: [
          {
            id: "q",
            kind: "text",
            label: "Q",
            required: false,
            options: [{ id: "a", label: "A" }],
          },
        ],
      }),
    );
    expect(form.questions[0]).toEqual({
      id: "q",
      kind: "text",
      label: "Q",
      required: false,
    });
    expect(
      sentence(
        parseTripPlanFormCreate({
          title: "T",
          visibleTo: "leaders",
          requiredToJoin: false,
          questions: [
            {
              id: "q",
              kind: "choice",
              label: "Q",
              required: false,
              options: [],
            },
          ],
        }),
      ),
    ).toMatch(/at least 2 options/);
  });

  it("caps questions at both ends", () => {
    const base = { title: "T", visibleTo: "leaders", requiredToJoin: false };
    expect(sentence(parseTripPlanFormCreate({ ...base, questions: [] }))).toBe(
      "A form needs at least one question.",
    );
    const many = Array.from(
      { length: TRIP_PLAN_MAX_QUESTIONS + 1 },
      (_, i) => ({
        id: `q${i}`,
        kind: "yesNo",
        label: "Q",
        required: false,
      }),
    );
    expect(parseTripPlanFormCreate({ ...base, questions: many })).toMatchObject(
      {
        status: 413,
      },
    );
  });

  // An answer object is a plain object: an id it already has (`__proto__`,
  // `toString`) can't hold an answer. Mutation: drop the Object.prototype
  // check in questionId.
  it("refuses a question id a plain object already has", () => {
    const base = { title: "T", visibleTo: "leaders", requiredToJoin: false };
    for (const id of ["__proto__", "toString", "constructor"])
      expect(
        isMalformed(
          parseTripPlanFormCreate({
            ...base,
            questions: [{ id, kind: "text", label: "Q", required: true }],
          }),
        ),
      ).toBe(true);
  });

  it("caps the arrays it drops or only compares", () => {
    const base = { title: "T", visibleTo: "leaders", requiredToJoin: false };
    const options = Array.from({ length: 31 }, (_, i) => ({
      id: `o${i}`,
      label: "O",
    }));
    expect(
      parseTripPlanFormCreate({
        ...base,
        questions: [
          { id: "q", kind: "text", label: "Q", required: false, options },
        ],
      }),
    ).toMatchObject({ status: 413 });
    const q = { id: "q", kind: "yesNo", label: "Q", required: false };
    expect(
      parseTripPlanFormPatch({
        questions: { from: Array.from({ length: 41 }, () => q), to: [q] },
      }),
    ).toMatchObject({ status: 413 });
  });

  // The print summary reads these answers by question id. Mutation: rename
  // safetyContacts' phone to tel.
  it("pins the question ids the print summary reads", () => {
    const ids = (id: "safetyContacts" | "carpool") =>
      TRIP_PLAN_FORM_PRESETS[id].questions.map((q) => q.id);
    expect(ids("safetyContacts")).toEqual(
      expect.arrayContaining(["name", "phone", "name2", "phone2"]),
    );
    expect(ids("carpool")).toEqual(
      expect.arrayContaining(["mode", "seats", "from"]),
    );
  });

  it("refuses a repeated question id or an unknown preset as malformed", () => {
    const q = { id: "q", kind: "yesNo", label: "Q", required: false };
    const base = { title: "T", visibleTo: "leaders", requiredToJoin: false };
    expect(
      isMalformed(parseTripPlanFormCreate({ ...base, questions: [q, q] })),
    ).toBe(true);
    expect(
      isMalformed(
        parseTripPlanFormCreate({ ...base, preset: "medical", questions: [q] }),
      ),
    ).toBe(true);
  });
});

describe("answers", () => {
  const questions = TRIP_PLAN_FORM_PRESETS.carpool.questions;
  const gear = TRIP_PLAN_FORM_PRESETS.gear.questions;
  const rules = TRIP_PLAN_FORM_PRESETS.rules.questions;

  it("normalises: trims text, drops what says nothing, dedupes ticks", () => {
    expect(
      value(
        parseTripPlanAnswers(questions, {
          mode: "lift",
          from: "  Katoomba ",
          notes: "",
          seats: null,
        }),
      ),
    ).toEqual({ mode: "lift", from: "Katoomba" });
    expect(
      value(parseTripPlanAnswers(gear, { items: ["helmet", "helmet"] })),
    ).toEqual({ items: ["helmet"] });
    expect(value(parseTripPlanAnswers(gear, { items: [] }))).toEqual({});
  });

  it("wants every required question, and an agree box ticked", () => {
    expect(sentence(parseTripPlanAnswers(questions, {}))).toBe(
      "Answer every question marked required.",
    );
    expect(sentence(parseTripPlanAnswers(rules, { agree: false }))).toBe(
      "Answer every question marked required.",
    );
    expect(value(parseTripPlanAnswers(rules, { agree: true }))).toEqual({
      agree: true,
    });
  });

  // A stale form, not a broken client: the person gets a sentence to act on.
  // Mutation: refuse any of these with bad(...) again.
  it("asks the person to check a form that changed since they opened it", () => {
    const changed =
      "This form changed since you opened it. Check it, then answer again.";
    const stale = [
      parseTripPlanAnswers(questions, { mode: "bus" }),
      parseTripPlanAnswers(questions, { mode: "lift", ghost: "x" }),
      parseTripPlanAnswers(questions, { mode: "lift", seats: "two" }),
      parseTripPlanAnswers(gear, { items: ["helmet", "crampons"] }),
      parseTripPlanAnswers(TRIP_PLAN_FORM_PRESETS.experience.questions, {
        trips: "few",
        abseil: "yes",
        swim: true,
      }),
    ];
    for (const parsed of stale)
      expect(parsed).toEqual({ sentence: changed, status: 409 });
    expect(
      sentence(parseTripPlanAnswers(questions, { mode: "lift", seats: -1 })),
    ).toBe("Answer with a whole number, 0 or more.");
  });

  it("caps a tick list at the number of options", () => {
    const many = Array.from({ length: 31 }, () => "helmet");
    expect(parseTripPlanAnswers(gear, { items: many })).toMatchObject({
      status: 413,
    });
  });

  it("reads a stored answer against the form as it is now", () => {
    const edited: TripPlanQuestion[] = [
      { id: "mode", kind: "yesNo", label: "Driving?", required: true },
      questions[2],
    ];
    expect(
      currentTripPlanAnswers(edited, {
        mode: "lift",
        from: "Katoomba",
        seats: 2,
      }),
    ).toEqual({ from: "Katoomba" });
    expect(currentTripPlanAnswers(edited, "junk")).toEqual({});
  });

  // Mutation: drop the multiChoice filter in currentTripPlanAnswers.
  it("keeps the ticks whose options are still there", () => {
    const fewer: TripPlanQuestion[] = [
      { ...gear[0], options: gear[0].options?.filter((o) => o.id !== "rope") },
    ];
    expect(
      currentTripPlanAnswers(fewer, { items: ["harness", "rope"] }),
    ).toEqual({ items: ["harness"] });
    expect(currentTripPlanAnswers(fewer, { items: ["rope"] })).toEqual({});
  });
});

// Every refusal is logged (malformed detail) or shown (sentence), so neither
// may carry what the person wrote. Mutation that turns it red: put the value
// into any `bad(...)` detail or `say` hole, e.g. `bad(\`${what}: ${value}\`)`.
// In `cas` only a `JSON.stringify(value)` echo shows: there the value is an
// object, which a template prints as "[object Object]".
describe("a refusal never echoes what the person wrote", () => {
  const secret = "Mira 0400 123 456 Hidden Gorge";
  const long = `${secret} `.repeat(400);
  const q = (over: object) => ({
    id: "q",
    kind: "text",
    label: secret,
    required: true,
    ...over,
  });
  const form = (over: object) => ({
    title: secret,
    visibleTo: "leaders",
    requiredToJoin: false,
    questions: [q({})],
    ...over,
  });
  const cases: TripPlanParsed<unknown>[] = [
    parseTripPlanCreate({ name: long }),
    parseTripPlanCreate({ name: [secret] }),
    parseTripPlanPatch({ dates: secret }),
    parseTripPlanCreate({ name: "x", tripTypes: secret }),
    parseTripPlanPatch({ name: { to: secret } }),
    parseTripPlanCreate({ name: secret, startDate: secret }),
    parseTripPlanCreate({ name: secret, tripTypes: [long] }),
    parseTripPlanCreate({ name: secret, tripTypes: [secret, secret] }),
    parseTripPlanPatch({ name: { from: 7, to: secret } }),
    parseTripPlanPatch({ tripTypes: { from: secret, to: [] } }),
    parseTripPlanSectionCreate({ title: long }),
    parseTripPlanSectionCreate({ title: secret, body: long.repeat(10) }),
    parseTripPlanSectionPatch({ title: { from: secret, to: 1 } }),
    parseTripPlanFormCreate(form({ title: long })),
    parseTripPlanFormCreate(form({ preset: secret })),
    parseTripPlanFormCreate(form({ questions: [q({ label: long })] })),
    parseTripPlanFormCreate(form({ questions: [q({ id: secret })] })),
    parseTripPlanFormCreate(form({ questions: [q({ kind: secret })] })),
    parseTripPlanFormCreate(form({ questions: [q({ help: long })] })),
    parseTripPlanFormCreate(
      form({
        questions: [
          q({
            kind: "choice",
            options: [
              { id: "a", label: long },
              { id: "b", label: "B" },
            ],
          }),
        ],
      }),
    ),
    parseTripPlanFormPatch({ visibleTo: { from: secret, to: "members" } }),
    parseTripPlanAnswers([q({})] as TripPlanQuestion[], { q: long }),
    parseTripPlanAnswers([q({})] as TripPlanQuestion[], { q: 5 }),
    parseTripPlanAnswers([q({})] as TripPlanQuestion[], { [secret]: "x" }),
    parseTripPlanAnswers(TRIP_PLAN_FORM_PRESETS.carpool.questions, {
      mode: secret,
    }),
    parseTripPlanAnswers(TRIP_PLAN_FORM_PRESETS.gear.questions, {
      items: [secret],
    }),
  ];

  it.each(cases.map((parsed, index) => [index, parsed]))(
    "case %i",
    (_index, parsed) => {
      expect("value" in parsed).toBe(false);
      const out = JSON.stringify(parsed);
      for (const word of ["Mira", "0400", "Hidden"])
        expect(out).not.toContain(word);
    },
  );

  it("its sentences keep the API's copy rules", () => {
    for (const parsed of cases)
      if ("sentence" in parsed)
        expect(apiSentenceViolations(parsed.sentence)).toEqual([]);
  });
});
