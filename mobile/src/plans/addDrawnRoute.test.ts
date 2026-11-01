import { beforeEach, describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => ({
  requestSync: vi.fn(),
  pendingCreateIds: vi.fn(),
  addPlanItem: vi.fn(),
  afterPlanWrite: vi.fn(),
}));
vi.mock("../sync/syncEngine", () => ({ requestSync: sync.requestSync }));
vi.mock("../sync/outbox", () => ({ pendingCreateIds: sync.pendingCreateIds }));
vi.mock("./plansApi", () => ({ addPlanItem: sync.addPlanItem }));
vi.mock("./plansCache", () => ({ afterPlanWrite: sync.afterPlanWrite }));

import { addDrawnRouteToPlan } from "./addDrawnRoute";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  sync.requestSync.mockResolvedValue(undefined);
  sync.pendingCreateIds.mockResolvedValue(new Set());
  sync.addPlanItem.mockResolvedValue(undefined);
});

describe("addDrawnRouteToPlan", () => {
  it("adds the route once the sync has landed", async () => {
    expect(await addDrawnRouteToPlan("p", "r")).toBe(true);
    expect(sync.addPlanItem).toHaveBeenCalledWith("p", {
      kind: "route",
      id: "r",
    });
    expect(sync.afterPlanWrite).toHaveBeenCalledWith("p");
  });

  // Mutation: skip the pending check, and the API 404s a route it has not seen.
  it("does not ask the plan while the route is still unsynced", async () => {
    sync.pendingCreateIds.mockResolvedValue(new Set(["r"]));
    expect(await addDrawnRouteToPlan("p", "r")).toBe(false);
    expect(sync.addPlanItem).not.toHaveBeenCalled();
  });

  it("is false, not thrown, when the add fails", async () => {
    sync.addPlanItem.mockRejectedValue(new Error("offline"));
    expect(await addDrawnRouteToPlan("p", "r")).toBe(false);
  });
});
