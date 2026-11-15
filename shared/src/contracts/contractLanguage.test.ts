import { afterEach, describe, expect, it } from "vitest";
import { setLanguageResolver } from "../i18n.js";
import { ANNOUNCEMENT } from "./inbox.js";
import { TRIP_PLAN_FORMS } from "./plans.js";

// A `t` in a module-level constant is written in the language known when the
// module loads, which the API cannot use: its language is per request.
// `ANNOUNCEMENT.untitled` is the member the API reads per recipient (the push
// title), so it is a getter, written when read. `visibleToLocked` is read by
// the clients' form builders and is a getter so that no contract sentence is
// written at import; the API's refusal uses the same function
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).

afterEach(() => setLanguageResolver(() => undefined));

describe("contract text read per request", () => {
  // Mutation: write `untitled` in `ANNOUNCEMENT` as a plain property,
  // untitled: t`A message from the Logjam maintainer`,
  it("the announcement's push title follows the language in force when it is read", () => {
    expect(ANNOUNCEMENT.untitled).toBe("A message from the Logjam maintainer");
    setLanguageResolver(() => "en-XA");
    expect(ANNOUNCEMENT.untitled).toMatch(/^⟦.*⟧$/u);
  });

  // Mutation: write `visibleToLocked` in `TRIP_PLAN_FORMS` as a property,
  // visibleToLocked: tripPlanVisibilityLockedSentence(), a call that runs at import.
  it("the form builder's locked-visibility sentence follows the language in force when it is read", () => {
    const english = TRIP_PLAN_FORMS.copy.visibleToLocked;
    setLanguageResolver(() => "en-XA");
    expect(TRIP_PLAN_FORMS.copy.visibleToLocked).not.toBe(english);
    expect(TRIP_PLAN_FORMS.copy.visibleToLocked).toContain("⟦");
  });
});
