import { describe, expect, it } from "vitest";
import type { TripPlanSummary } from "../tripPlans.js";
import { tripPlansMoreSubtitle } from "./index.js";

const TODAY = "2026-10-19";
const summary = (over: Partial<TripPlanSummary>): TripPlanSummary => ({
  id: "p",
  name: "Wollangambe trip",
  startDate: null,
  endDate: null,
  tripTypes: [],
  archivedAt: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  status: "active",
  role: "member",
  ...over,
});

describe("the More hub's Plans row", () => {
  // Mutation: count invites after the upcoming plans, or not at all.
  it("says what waits on the caller before what is coming up", () => {
    const plans = [
      summary({ startDate: "2026-11-08" }),
      summary({ status: "invited" }),
    ];
    expect(tripPlansMoreSubtitle(plans, TODAY)).toBe("1 waiting on you");
    expect(tripPlansMoreSubtitle(plans.slice(0, 1), TODAY)).toBe("1 upcoming");
  });

  it("counts neither a past nor an archived plan as coming up", () => {
    const plans = [
      summary({ startDate: "2026-09-01" }),
      summary({ archivedAt: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(tripPlansMoreSubtitle(plans, TODAY)).toBe("Nothing planned");
  });
});
