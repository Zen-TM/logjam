import { describe, expect, it } from "vitest";
import { NSW_REGION } from "@logjam/shared";
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
// What a simulated northern region declares (shared/src/simRegions.ts).
const DENVER = "America/Denver";
const active = { role: "member", status: "active", invitedBy: null };
const owed = (
  over: Partial<Parameters<typeof planSummary>[0]>,
  now: string,
  member = active,
  timeZone = NSW_REGION.timeZone,
) =>
  planSummary(plan(over), member, null, 2, timeZone, new Date(now))
    .unansweredForms;

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
  // Mutation: read Sydney's day whatever time zone is passed.
  it("is zero once the trip is over, in the account region's calendar day", () => {
    // 10 Nov 03:00Z is 9 Nov 20:00 in Denver: the trip's last day is not over.
    expect(owed({}, "2026-11-10T03:00:00Z", active, DENVER)).toBe(2);
    // 10 Nov 08:00Z is 10 Nov 01:00 in Denver: it is.
    expect(owed({}, "2026-11-10T08:00:00Z", active, DENVER)).toBe(0);
  });
  // Mutation: drop the leader test from `owing`.
  it("is zero for a leader, whatever is unanswered", () => {
    expect(
      owed({}, "2026-11-02T00:00:00Z", { ...active, role: "leader" }),
    ).toBe(0);
    expect(
      owed({}, "2026-11-02T00:00:00Z", { ...active, role: "editor" }),
    ).toBe(2);
  });
  it("is zero for an archived plan or one the caller has no seat in", () => {
    expect(owed({ archivedAt: new Date() }, "2026-11-02T00:00:00Z")).toBe(0);
    expect(
      owed({}, "2026-11-02T00:00:00Z", { ...active, status: "invited" }),
    ).toBe(0);
  });
});
