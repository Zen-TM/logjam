import { describe, expect, it } from "vitest";

import { planSelectable, runPlanBulk } from "./planBulk";

const plan = (role: "leader" | "editor" | "member", status = "active") =>
  ({ role, status }) as never;

describe("planSelectable", () => {
  // Mutation: select every row, and an invite is "left" without an answer.
  it("is only a plan you are in", () => {
    expect(planSelectable(plan("member"))).toBe(true);
    expect(planSelectable(plan("member", "invited"))).toBe(false);
    expect(planSelectable(plan("member", "requested"))).toBe(false);
  });
});

describe("runPlanBulk", () => {
  const ok = () => Promise.resolve();
  const fail = () => Promise.reject(new Error("nope"));
  // Mutation: count the rejected calls as done, or drop failedIds, and a plan
  // that did not go through leaves the selection.
  it("names the plans that failed and counts each kind", async () => {
    const result = await runPlanBulk([
      { id: "a", kind: "delete", run: ok },
      { id: "b", kind: "delete", run: fail },
      { id: "c", kind: "leave", run: ok },
    ]);
    expect(result.failedIds).toEqual(["b"]);
    expect(result.message).toBe(
      "Deleted 1 of 2 plans. The rest didn't go through. Left 1 plan.",
    );
  });
  it("has nothing failed when every call lands", async () => {
    const result = await runPlanBulk([{ id: "a", kind: "archive", run: ok }]);
    expect(result).toEqual({ message: "Archived 1 plan.", failedIds: [] });
  });
});
