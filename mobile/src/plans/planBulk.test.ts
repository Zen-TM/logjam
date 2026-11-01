import { describe, expect, it } from "vitest";

import { planBulkConfirm, planBulkSplit, planSelectable } from "./planBulk";

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

describe("planBulkConfirm", () => {
  // Mutation: drop a count, and the dialog hides half of what happens.
  it("names each count", () => {
    expect(planBulkConfirm({ lead: 2, leave: 1 }).confirmTitle).toBe(
      "Delete 2 plans and leave 1 plan?",
    );
    expect(planBulkConfirm({ lead: 1, leave: 0 }).confirmTitle).toBe(
      "Delete 1 plan?",
    );
    expect(planBulkConfirm({ lead: 0, leave: 3 })).toMatchObject({
      confirmTitle: "Leave 3 plans?",
      confirmLabel: "Leave",
    });
  });
});
