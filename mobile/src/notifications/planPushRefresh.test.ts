import { describe, expect, it } from "vitest";

import { planPushRefresh } from "./planPushRefresh";

describe("planPushRefresh", () => {
  // Mutation: drop the capability check. A guest's phone would call the API.
  it("asks nothing for a guest", () => {
    expect(
      planPushRefresh({ type: "plan_invited", planId: "p" }, "guest"),
    ).toBe(null);
  });

  // Mutation: drop the `plan_` filter. Every push would refetch plans.
  it("asks nothing for a push that is not about a plan", () => {
    expect(planPushRefresh({ type: "friend_request" }, "linked")).toBe(null);
    expect(planPushRefresh({ planId: "p" }, "linked")).toBe(null);
    expect(planPushRefresh(null, "linked")).toBe(null);
    expect(planPushRefresh("plan_invited", "linked")).toBe(null);
  });

  // Mutation: pass planId through unchecked. A number would reach the URL.
  it("names the plan only when the push carries its id as a string", () => {
    expect(
      planPushRefresh({ type: "plan_member_joined", planId: "p" }, "linked"),
    ).toEqual({ planId: "p" });
    expect(
      planPushRefresh({ type: "plan_member_joined", planId: 7 }, "linked"),
    ).toEqual({ planId: null });
    expect(planPushRefresh({ type: "plan_deleted" }, "linked")).toEqual({
      planId: null,
    });
  });
});
