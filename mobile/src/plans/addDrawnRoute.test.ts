import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDrawnRouteToPlan, drawnRouteTarget } from "./addDrawnRoute";

const api = vi.hoisted(() => ({
  addPlanItem: vi.fn(),
  afterPlanWrite: vi.fn(),
}));
vi.mock("./plansApi", () => ({ addPlanItem: api.addPlanItem }));
vi.mock("./plansCache", () => ({ afterPlanWrite: api.afterPlanWrite }));

beforeEach(() => {
  vi.clearAllMocks();
  api.addPlanItem.mockResolvedValue(undefined);
});

const route = {
  name: "Water drop to the car",
  color: "#3366ff",
  points: [
    [150.4, -33.5],
    [150.41, -33.51],
  ] as [number, number][],
  anchors: [0, 1],
};

describe("addDrawnRouteToPlan", () => {
  // Mutation: send `{ kind: "route", id }` (a copy of a saved route), and the
  // API 404s a route the account never had.
  it("makes the route in the plan from its points, not a saved route", async () => {
    await addDrawnRouteToPlan("p", route);
    expect(api.addPlanItem).toHaveBeenCalledWith("p", {
      kind: "route",
      new: route,
    });
    expect(api.afterPlanWrite).toHaveBeenCalledWith("p");
  });

  // Mutation: catch the refusal and return, and the map closes the draft on a
  // route that was never added.
  it("throws when the add fails, and does not refresh the plan", async () => {
    api.addPlanItem.mockRejectedValue(new Error("offline"));
    await expect(addDrawnRouteToPlan("p", route)).rejects.toThrow("offline");
    expect(api.afterPlanWrite).not.toHaveBeenCalled();
  });
});

describe("drawnRouteTarget", () => {
  // Mutation: test `planId` before `placeId` or `editingRouteId`, and an edit
  // or a place's slot draw lands in a plan.
  it.each([
    [{ editingRouteId: "r", placeId: null, planId: "p" }, "edit"],
    [{ editingRouteId: null, placeId: "x", planId: "p" }, "place"],
    [{ editingRouteId: null, placeId: null, planId: "p" }, "plan"],
    [{ editingRouteId: null, placeId: null, planId: null }, "account"],
  ] as const)("%j goes to %s", (draw, target) => {
    expect(drawnRouteTarget(draw)).toBe(target);
  });
});
