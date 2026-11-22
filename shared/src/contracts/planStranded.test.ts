import { describe, expect, it } from "vitest";
import { planRefusalStands, planRouteStrandedConfirm } from "./index.js";

describe("planRefusalStands", () => {
  // Mutation: add 500 (or 0, a dropped connection) to the list, and a route
  // is offered "Save to Saved" over an outage that a retry would clear.
  it("holds for a plan that is gone, closed to the caller, or archived", () => {
    for (const status of [403, 404, 409])
      expect(planRefusalStands(status)).toBe(true);
    for (const status of [0, 400, 401, 413, 429, 500, 503])
      expect(planRefusalStands(status)).toBe(false);
  });
});

describe("planRouteStrandedConfirm", () => {
  // Mutation: rename the label, and Logjam GPS's confirm and Logjam Web's
  // would no longer name the place the route lands.
  it("offers Save to Saved after the plan's own reason", () => {
    const copy = planRouteStrandedConfirm("This plan is archived.");
    expect(copy.confirmLabel).toBe("Save to Saved");
    expect(copy.confirmBody).toContain("This plan is archived.");
    expect(copy.tone).toBe("filled");
  });
});
