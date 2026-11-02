import { describe, expect, it } from "vitest";
import { limitHint, planSectionsMoved, planSectionVerbs } from "./index.js";

const ids = (verbs: { id: string }[]) => verbs.map((verb) => verb.id);

describe("planSectionVerbs", () => {
  // Mutation: drop the position filter. The first section would offer Move
  // up, which the order PUT can't do.
  it("leaves out the moves a section's place can't make", () => {
    const at = (index: number, count: number) =>
      ids(planSectionVerbs("gps", "editor", { archived: false, index, count }));
    expect(at(0, 3)).toEqual(["edit", "moveDown", "delete"]);
    expect(at(2, 3)).toEqual(["edit", "moveUp", "delete"]);
    expect(at(1, 3)).toEqual(["edit", "moveUp", "moveDown", "delete"]);
    expect(at(0, 1)).toEqual(["edit", "delete"]);
  });

  // Mutation: pass `archived: false` through. An archived plan's section
  // would offer verbs the API refuses.
  it("offers nothing on an archived plan or to a member", () => {
    expect(
      planSectionVerbs("gps", "leader", { archived: true, index: 0, count: 2 }),
    ).toEqual([]);
    expect(
      planSectionVerbs("gps", "member", {
        archived: false,
        index: 0,
        count: 2,
      }),
    ).toEqual([]);
  });
});

describe("planSectionsMoved", () => {
  // Mutation: swap with `index - by`. Move up would move it down.
  it("swaps a section with its neighbour, and refuses past an end", () => {
    expect(planSectionsMoved(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(planSectionsMoved(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(planSectionsMoved(["a", "b"], 0, -1)).toBeNull();
    expect(planSectionsMoved(["a", "b"], 1, 1)).toBeNull();
    expect(planSectionsMoved(["a", "b"], -1, 1)).toBeNull();
  });
});

describe("limitHint", () => {
  // Mutation: show it from 0, or compare with `>=` at 90 %.
  it("says the count only past 90 % of the limit", () => {
    expect(limitHint(18_000, 20_000)).toBeUndefined();
    expect(limitHint(18_001, 20_000)).toBe("18001 of 20000 characters");
  });
});
