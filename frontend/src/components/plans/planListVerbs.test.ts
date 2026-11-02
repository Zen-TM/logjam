import { describe, expect, it } from "vitest";
import type { TripPlanSummary } from "@logjam/shared";
import { listVerbs } from "./planListVerbs";

const plan = (over: Partial<TripPlanSummary>): TripPlanSummary => ({
  id: "p",
  name: "Trip",
  startDate: null,
  endDate: null,
  tripTypes: [],
  archivedAt: null,
  updatedAt: "2026-01-01T00:00:00Z",
  status: "active",
  role: "leader",
  unansweredForms: 0,
  ...over,
});

describe("a plan card's verbs", () => {
  it("a leader archives or deletes, never leaves", () => {
    expect(listVerbs(plan({})).map((v) => v.id)).toEqual(["archive", "delete"]);
  });
  it("a member leaves", () => {
    expect(listVerbs(plan({ role: "member" })).map((v) => v.id)).toEqual([
      "leave",
    ]);
  });
  it("an archived plan is brought back, not archived", () => {
    const archived = plan({ archivedAt: "2026-01-02T00:00:00Z" });
    expect(listVerbs(archived).map((v) => v.id)).toEqual([
      "unarchive",
      "delete",
    ]);
  });
});
