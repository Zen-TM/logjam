import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@logjam/shared";
import {
  addDrawnRouteToPlan,
  drawnRouteTarget,
  saveDrawnRouteForPlan,
} from "./addDrawnRoute";

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

describe("saveDrawnRouteForPlan", () => {
  const keep = vi.fn();
  const ask = vi.fn();
  const refused = (status: number) =>
    new ApiError(status, "/plans/p/items", "POST", "Couldn't find that plan.");
  beforeEach(() => {
    keep.mockReset().mockResolvedValue(undefined);
    ask.mockReset().mockResolvedValue(true);
  });

  it("adds the route to the plan and asks nothing", async () => {
    expect(await saveDrawnRouteForPlan("p", route, { keep, ask })).toBe(
      "added",
    );
    expect(ask).not.toHaveBeenCalled();
    expect(keep).not.toHaveBeenCalled();
  });

  // Mutation: skip the `ask`, and the route is saved to the account without
  // the user choosing it; skip `keep`, and the points are lost.
  it.each([403, 404, 409])(
    "offers Save to Saved when the plan refuses with %i, and keeps the route if taken",
    async (status) => {
      api.addPlanItem.mockRejectedValue(refused(status));
      expect(await saveDrawnRouteForPlan("p", route, { keep, ask })).toBe(
        "kept",
      );
      expect(ask.mock.calls[0][0].confirmLabel).toBe("Save to Saved");
      expect(keep).toHaveBeenCalledTimes(1);
    },
  );

  // Mutation: call `keep` whatever the answer, and a declined offer still
  // saves the route.
  it("leaves the draft alone when the offer is declined", async () => {
    api.addPlanItem.mockRejectedValue(refused(404));
    ask.mockResolvedValue(false);
    expect(await saveDrawnRouteForPlan("p", route, { keep, ask })).toBe(
      "declined",
    );
    expect(keep).not.toHaveBeenCalled();
  });

  // Mutation: treat every refusal as standing, and an outage offers Save to
  // Saved for a route the plan would take on the next try.
  it.each([new Error("offline"), refused(500)])(
    "throws a failure a retry may clear, with no offer",
    async (err) => {
      api.addPlanItem.mockRejectedValue(err);
      await expect(
        saveDrawnRouteForPlan("p", route, { keep, ask }),
      ).rejects.toBe(err);
      expect(ask).not.toHaveBeenCalled();
    },
  );
});
