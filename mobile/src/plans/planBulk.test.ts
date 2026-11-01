import { describe, expect, it } from "vitest";

import { planBulkSplit, planSelectable } from "./planBulk";

const plan = (role: "leader" | "editor" | "member", status = "active") =>
  ({ role, status }) as never;

describe("planBulkSplit", () => {
  // Mutation: send every plan to `lead`, and a plan you only joined is
  // deleted for everyone.
  it("deletes the plans you lead and leaves the rest", () => {
    const { lead, leave } = planBulkSplit([
      plan("leader"),
      plan("editor"),
      plan("member"),
    ]);
    expect(lead).toHaveLength(1);
    expect(leave).toHaveLength(2);
  });
});

describe("planSelectable", () => {
  // Mutation: select every row, and an invite is "left" without an answer.
  it("is only a plan you are in", () => {
    expect(planSelectable(plan("member"))).toBe(true);
    expect(planSelectable(plan("member", "invited"))).toBe(false);
    expect(planSelectable(plan("member", "requested"))).toBe(false);
  });
});
