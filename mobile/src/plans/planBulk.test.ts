import { describe, expect, it } from "vitest";

import { planSelectable } from "./planBulk";

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
