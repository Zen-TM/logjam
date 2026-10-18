import { describe, expect, it } from "vitest";
import {
  isDateOnly,
  parseTripPlanCreate,
  parseTripPlanOrder,
  parseTripPlanPatch,
  parseTripPlanSectionCreate,
  parseTripPlanSectionPatch,
  type TripPlanParsed,
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

  it("patches a section field by field", () => {
    expect(
      value(parseTripPlanSectionPatch({ body: { from: "a", to: "b\n\n" } })),
    ).toEqual({ body: { from: "a", to: "b" } });
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

// Every refusal is logged (malformed detail) or shown (sentence), so neither
// may carry what the person wrote. Mutation that turns it red: put the value
// into any `bad(...)` detail or `say` hole, e.g. `bad(\`${what}: ${value}\`)`.
describe("a refusal never echoes what the person wrote", () => {
  const secret = "Mira 0400 123 456 Hidden Gorge";
  const long = `${secret} `.repeat(400);
  const cases: TripPlanParsed<unknown>[] = [
    parseTripPlanCreate({ name: long }),
    parseTripPlanCreate({ name: secret, startDate: secret }),
    parseTripPlanCreate({ name: secret, tripTypes: [long] }),
    parseTripPlanCreate({ name: secret, tripTypes: [secret, secret] }),
    parseTripPlanPatch({ name: { from: 7, to: secret } }),
    parseTripPlanPatch({ tripTypes: { from: secret, to: [] } }),
    parseTripPlanSectionCreate({ title: long }),
    parseTripPlanSectionCreate({ title: secret, body: long.repeat(10) }),
    parseTripPlanSectionPatch({ title: { from: secret, to: 1 } }),
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
