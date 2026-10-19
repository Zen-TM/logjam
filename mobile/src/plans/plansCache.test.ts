// The plans cache against a real SQLite (node:sqlite), so each assertion is
// about the rows a plan screen will read, not a statement being issued.
import { DatabaseSync } from "node:sqlite";
import { ApiError } from "@logjam/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlite = new DatabaseSync(":memory:");
const adapter = {
  execAsync: (sql: string) => {
    sqlite.exec(sql);
    return Promise.resolve();
  },
  runAsync: (sql: string, ...params: unknown[]) => {
    sqlite.prepare(sql).run(...(params as never[]));
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  },
  getFirstAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).get(...(params as never[])) ?? null),
  getAllAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).all(...(params as never[]))),
  withTransactionAsync: async (task: () => Promise<void>) => {
    sqlite.exec("BEGIN");
    try {
      await task();
      sqlite.exec("COMMIT");
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  },
};
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: () => Promise.resolve(adapter),
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("../offline/networkPolicy", () => ({ canRunNow: async () => true }));
const api = vi.hoisted(() => ({ getPlans: vi.fn(), getPlan: vi.fn() }));
vi.mock("./plansApi", () => api);

const { wipeAllSyncData } = await import("../sync/syncDb");
const {
  fetchPlan,
  planChanged,
  pollPlans,
  readCachedPlan,
  readCachedPlanStamps,
  readPlansList,
} = await import("./plansCache");

const summary = (
  id: string,
  status = "active",
  updatedAt = "2026-10-01T00:00:00.000Z",
) => ({
  id,
  name: `Plan ${id}`,
  startDate: null,
  endDate: null,
  tripTypes: [],
  archivedAt: null,
  updatedAt,
  status,
  role: "member",
});
const view = (id: string, updatedAt = "2026-10-01T00:00:00.000Z") => ({
  ...summary(id),
  updatedAt,
  myRole: "member",
  sections: [],
  members: [],
  places: [],
  routes: [],
  files: [],
  geoPdfs: [],
  forms: [],
});

beforeEach(async () => {
  await wipeAllSyncData();
  vi.clearAllMocks();
});

describe("the plans poll", () => {
  // Mutation: drop the DELETE loop in pollPlans. A plan the caller left (or
  // was removed from) would stay readable on this phone.
  it("drops a cached plan the poll no longer lists, and keeps the rest", async () => {
    api.getPlan.mockImplementation(async (id: string) => view(id));
    await fetchPlan("kept");
    await fetchPlan("left");
    await fetchPlan("uninvited");
    api.getPlans.mockResolvedValue({
      plans: [summary("kept"), summary("uninvited", "invited")],
    });
    await pollPlans();
    expect([...(await readCachedPlanStamps()).keys()]).toEqual(["kept"]);
    expect((await readPlansList())?.plans.map((plan) => plan.id)).toEqual([
      "kept",
      "uninvited",
    ]);
  });

  // Mutation: clear the cache before the fetch. Offline, the list would empty.
  it("leaves the cache alone when the poll fails", async () => {
    api.getPlans.mockResolvedValueOnce({ plans: [summary("a")] });
    await pollPlans();
    api.getPlans.mockRejectedValueOnce(new Error("offline"));
    await expect(pollPlans()).rejects.toThrow("offline");
    expect((await readPlansList())?.plans).toHaveLength(1);
  });
});

describe("fetching one plan", () => {
  // Mutation: write the row with INSERT OR REPLACE. A refresh would forget
  // the plan was downloaded for the trip.
  it("keeps when it was downloaded across a refetch", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    await fetchPlan("a");
    sqlite.exec(
      "UPDATE plans_cache SET downloaded_at = '2026-10-02T00:00:00.000Z'",
    );
    api.getPlan.mockResolvedValue(view("a", "2026-10-03T00:00:00.000Z"));
    const fresh = await fetchPlan("a");
    expect(fresh.downloadedAt).toBe("2026-10-02T00:00:00.000Z");
    expect((await readCachedPlan("a"))?.plan.updatedAt).toBe(
      "2026-10-03T00:00:00.000Z",
    );
  });

  // Mutation: drop the 404 branch. A plan deleted or left elsewhere would
  // keep reading from the cache.
  it("drops the cached copy when the plan is gone", async () => {
    api.getPlan.mockResolvedValueOnce(view("a"));
    await fetchPlan("a");
    api.getPlan.mockRejectedValueOnce(new ApiError(404, "/plans/a", "GET"));
    await expect(fetchPlan("a")).rejects.toThrow();
    expect(await readCachedPlan("a")).toBeNull();
  });

  // Mutation: list plans_cache as `local` in mirrorSchema.ts.
  it("goes with the account on sign-out", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    await fetchPlan("a");
    await wipeAllSyncData();
    expect(await readCachedPlan("a")).toBeNull();
  });
});

describe("planChanged", () => {
  const stamp = { updatedAt: "2026-10-01T00:00:00.000Z", downloadedAt: null };
  it("is true only when the poll's plan is newer than the cached copy", () => {
    expect(planChanged({ updatedAt: "2026-10-02T00:00:00.000Z" }, stamp)).toBe(
      true,
    );
    expect(planChanged({ updatedAt: stamp.updatedAt }, stamp)).toBe(false);
    expect(planChanged({ updatedAt: stamp.updatedAt }, undefined)).toBe(false);
  });
});
