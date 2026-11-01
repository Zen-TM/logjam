import { describe, expect, it } from "vitest";
import { planSummary } from "./tripPlanView";

const plan = (over: Partial<Parameters<typeof planSummary>[0]> = {}) => ({
  id: "p",
  name: "Plan",
  startDate: new Date("2026-11-08"),
  endDate: new Date("2026-11-09"),
  tripTypes: [],
  archivedAt: null,
  updatedAt: new Date("2026-11-01"),
  ...over,
});
const active = { role: "member", status: "active", invitedBy: null };
const owed = (
  over: Partial<Parameters<typeof planSummary>[0]>,
  now: string,
  member = active,
) => planSummary(plan(over), member, null, 2, new Date(now)).unansweredForms;

// The list count follows `tripPlanFormsToAnswer`. Mutation: drop the archive
// or the over test from `owing`.
describe("planSummary unansweredForms", () => {
  it("counts for a plan that is coming or running", () => {
    expect(owed({}, "2026-11-02T00:00:00Z")).toBe(2);
    expect(owed({}, "2026-11-09T00:00:00Z")).toBe(2);
    expect(
      owed({ startDate: null, endDate: null }, "2030-01-01T00:00:00Z"),
    ).toBe(2);
  });
  it("is zero once the trip is over, in NSW's calendar day", () => {
    expect(owed({}, "2026-11-10T00:00:00Z")).toBe(0);
    // 09 Nov 14:00Z is already 10 Nov in Sydney.
    expect(owed({}, "2026-11-09T14:00:00Z")).toBe(0);
  });
  it("is zero for an archived plan or one the caller has no seat in", () => {
    expect(owed({ archivedAt: new Date() }, "2026-11-02T00:00:00Z")).toBe(0);
    expect(
      owed({}, "2026-11-02T00:00:00Z", { ...active, status: "invited" }),
    ).toBe(0);
  });
});
