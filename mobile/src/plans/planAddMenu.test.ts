import { PLAN_ITEM_ADD, PLAN_ITEM_ADD_VERBS } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { planAddMenuView } from "./planAddMenu";

describe("planAddMenuView", () => {
  // Mutation: take the verbs from anything but `planItemAddMenu`, and the menu
  // lists the write-up, form or invite verbs, or loses an entry.
  it.each(["leader", "editor", "member"] as const)(
    "gives a %s one Add a place or way button over the five item verbs, in order",
    (role) => {
      const view = planAddMenuView(role, false)!;
      expect(view.label).toBe(PLAN_ITEM_ADD.label);
      expect(view.icon).toBe(PLAN_ITEM_ADD.icon);
      expect(view.rows.map((row) => row.verb.id)).toEqual([
        ...PLAN_ITEM_ADD_VERBS,
      ]);
    },
  );

  // Mutation: ignore `archived`, and a finished plan offers adds the API
  // refuses.
  it("offers no menu on an archived plan", () => {
    expect(planAddMenuView("leader", true)).toBeNull();
  });

  // Mutation: never draw the rule, and the menu loses the line between what is
  // copied from the account and what is made.
  it("draws one rule, above the first verb that makes the item in the plan", () => {
    const view = planAddMenuView("member", false)!;
    expect(
      view.rows.filter((row) => row.ruled).map((row) => row.verb.id),
    ).toEqual(["newPlace"]);
  });
});
