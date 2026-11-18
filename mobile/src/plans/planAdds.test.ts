import { describe, expect, it } from "vitest";
import { itemAddVerbs } from "./planAdds";

const ids = (role: Parameters<typeof itemAddVerbs>[0], archived = false) =>
  itemAddVerbs(role, archived).map((verb) => verb.id);

describe("itemAddVerbs", () => {
  // Mutation: drop `import` from `PLAN_ITEM_ADD_VERBS`, and a plan on Logjam
  // GPS loses that button.
  it("offers a member every way to put a place or way in the plan", () => {
    expect(ids("member")).toEqual(["copy", "newPlace", "route", "import"]);
  });

  // Mutation: filter on nothing, and the Map view draws the write-up, form and
  // invite verbs as buttons it has no handler for.
  it("leaves out the verbs that make something else", () => {
    expect(ids("leader")).toEqual(["copy", "newPlace", "route", "import"]);
  });

  // Mutation: ignore `archived`, and an archived plan takes new items.
  it("offers nothing on an archived plan", () => {
    expect(ids("leader", true)).toEqual([]);
  });
});
