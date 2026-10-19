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
const files = vi.hoisted(() => ({
  planFiles: vi.fn(() => [
    { id: "f", url: "u", filename: "f.jpg", sizeBytes: 5 },
  ]),
  missingPlanFiles: vi.fn(async (_id: string, all: unknown[]) => all),
  downloadPlanFiles: vi.fn(async () => true),
  prunePlanFiles: vi.fn(async () => {}),
  deletePlanFolder: vi.fn(async () => {}),
  sweepPlanFolders: vi.fn(async () => {}),
}));
vi.mock("./planFiles", () => files);
const space = vi.hoisted(() => ({ assertSpaceFor: vi.fn(async () => {}) }));
vi.mock("../offline/freeSpace", () => space);

const { clearMirror, wipeAllSyncData, wipeMirror } = await import(
  "../sync/syncDb"
);
const {
  afterPlanWrite,
  downloadPlan,
  fetchPlan,
  planChanged,
  pollPlans,
  readCachedPlan,
  readCachedPlanStamps,
  readPlansList,
  stopPlansForWipe,
} = await import("./plansCache");

/** A GET held open until the test lets it land. */
function held<T>() {
  let land!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    land = resolve;
  });
  return { promise, land };
}

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
  await stopPlansForWipe();
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
    // Mutation: drop the sweep. A left plan's photos stay on the phone.
    expect(files.sweepPlanFolders).toHaveBeenLastCalledWith(new Set(["kept"]));
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
    // Mutation: drop deletePlanFolder from the 404 path.
    expect(files.deletePlanFolder).toHaveBeenCalledWith("a");
  });
});

describe("the account's plans leave with it", () => {
  // Mutation: wipeAllSyncData deletes only the `local` tables.
  it("on sign-out", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    api.getPlans.mockResolvedValue({ plans: [summary("a")] });
    await fetchPlan("a");
    await pollPlans();
    await wipeAllSyncData();
    expect(await readCachedPlan("a")).toBeNull();
    expect(await readPlansList()).toBeNull();
  });

  // Mutation: list the plans tables as `local` in mirrorSchema.ts, or have
  // clearMirror skip `keepOnReset` tables.
  it("on a user change (clearMirror)", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    api.getPlans.mockResolvedValue({ plans: [summary("a")] });
    await fetchPlan("a");
    await pollPlans();
    await clearMirror();
    expect(await readCachedPlan("a")).toBeNull();
    expect(await readPlansList()).toBeNull();
  });

  // Mutation: drop the epoch check in pollPlans. A poll in flight at sign-out
  // would write the departing user's list back after the wipe.
  it("even when a poll lands after the wipe", async () => {
    const get = held<{ plans: ReturnType<typeof summary>[] }>();
    api.getPlans.mockReturnValueOnce(get.promise);
    const poll = pollPlans();
    await stopPlansForWipe();
    await wipeAllSyncData();
    get.land({ plans: [summary("a")] });
    await poll;
    expect(await readPlansList()).toBeNull();
  });

  // Mutation: drop the epoch check in fetchPlan.
  it("even when a plan's fetch lands after the wipe", async () => {
    const get = held<ReturnType<typeof view>>();
    api.getPlan.mockReturnValueOnce(get.promise);
    const fetch = fetchPlan("a");
    await stopPlansForWipe();
    await wipeAllSyncData();
    get.land(view("a"));
    await fetch;
    expect(await readCachedPlan("a")).toBeNull();
  });
});

describe("a mirror reset keeps the plans", () => {
  // Mutation: wipeMirror stops skipping `keepOnReset` tables. Resync from
  // scratch would delete every plan downloaded for the trip.
  it("through wipeMirror, with when it was downloaded", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    api.getPlans.mockResolvedValue({ plans: [summary("a")] });
    await fetchPlan("a");
    await pollPlans();
    sqlite.exec(
      "UPDATE plans_cache SET downloaded_at = '2026-10-02T00:00:00.000Z'",
    );
    await wipeMirror();
    expect((await readCachedPlan("a"))?.downloadedAt).toBe(
      "2026-10-02T00:00:00.000Z",
    );
    expect(await readPlansList()).not.toBeNull();
  });

  // Mutation: dropStaleMirror stops skipping `keepOnReset` tables. An app
  // update that bumps the mirror schema would drop every cached plan.
  it("through a schema-version bump", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    await fetchPlan("a");
    sqlite.exec(
      "UPDATE sync_state SET value = '0' WHERE key = 'schemaVersion'",
    );
    vi.resetModules();
    const reopened = await import("./plansCache");
    expect(await reopened.readCachedPlan("a")).not.toBeNull();
  });
});

describe("an older poll and a newer fetch", () => {
  // Mutation: drop `fetched_at <= ?` from the poll's DELETE. A poll answered
  // before the caller was let in would delete the plan they just opened.
  it("keeps a plan fetched after the poll began", async () => {
    const get = held<{ plans: ReturnType<typeof summary>[] }>();
    api.getPlans.mockReturnValueOnce(get.promise);
    const poll = pollPlans();
    await new Promise((resolve) => setTimeout(resolve, 2));
    api.getPlan.mockResolvedValueOnce(view("p"));
    await fetchPlan("p");
    get.land({ plans: [summary("p", "requested")] });
    await poll;
    expect(await readCachedPlan("p")).not.toBeNull();
  });
});

describe("after a write", () => {
  // Mutation: drop the DELETE in afterPlanWrite's `gone` branch. A plan the
  // caller just left would stay readable until the next poll.
  it("drops the plan the caller left, before the list says so", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    await fetchPlan("a");
    api.getPlans.mockResolvedValue({ plans: [summary("a")] });
    await afterPlanWrite("a", true);
    expect(await readCachedPlan("a")).toBeNull();
    expect(api.getPlan).toHaveBeenCalledTimes(1);
    // Mutation: drop deletePlanFolder from the gone path.
    expect(files.deletePlanFolder).toHaveBeenCalledWith("a");
  });

  // Mutation: drop the `dropped` check in fetchPlan. A fetch begun before a
  // Leave would put the plan back after it.
  it("keeps a left plan off the phone when an older fetch lands", async () => {
    const get = held<ReturnType<typeof view>>();
    api.getPlan.mockReturnValueOnce(get.promise);
    const fetch = fetchPlan("a");
    api.getPlans.mockResolvedValue({ plans: [] });
    await afterPlanWrite("a", true);
    get.land(view("a"));
    await fetch;
    expect(await readCachedPlan("a")).toBeNull();
  });

  it("fetches the plan again otherwise", async () => {
    api.getPlan.mockResolvedValueOnce(view("a"));
    await fetchPlan("a");
    api.getPlans.mockResolvedValue({ plans: [summary("a")] });
    api.getPlan.mockResolvedValueOnce(view("a", "2026-10-05T00:00:00.000Z"));
    await afterPlanWrite("a");
    expect((await readCachedPlan("a"))?.plan.updatedAt).toBe(
      "2026-10-05T00:00:00.000Z",
    );
  });
});

describe("Download for the trip", () => {
  // Mutation: drop the epoch check after the fetch. A download running at
  // sign-out would fetch the departing user's files after the wipe.
  it("stops when the wipe comes while it fetches the plan", async () => {
    const get = held<ReturnType<typeof view>>();
    api.getPlan.mockReturnValueOnce(get.promise);
    const run = downloadPlan("a", () => {});
    const stop = stopPlansForWipe();
    await wipeAllSyncData();
    get.land(view("a"));
    await run;
    await stop;
    expect(files.downloadPlanFiles).not.toHaveBeenCalled();
    expect(await readCachedPlan("a")).toBeNull();
  });

  // Mutation: remove the assertSpaceFor call. A full phone would fail
  // partway through hundreds of MB.
  it("asks whether the files fit before writing any", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    space.assertSpaceFor.mockRejectedValueOnce(new Error("full"));
    await expect(downloadPlan("a", () => {})).rejects.toThrow("full");
    expect(files.downloadPlanFiles).not.toHaveBeenCalled();
    expect((await readCachedPlan("a"))?.downloadedAt).toBeNull();
  });

  // Mutation: back to sweeping by an emptied cache. A Resync from scratch
  // would delete every downloaded plan's files on the next poll.
  it("keeps a downloaded plan's files through a mirror reset", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    await downloadPlan("a", () => {});
    await wipeMirror();
    api.getPlans.mockResolvedValue({ plans: [summary("a")] });
    await pollPlans();
    expect(files.sweepPlanFolders).toHaveBeenLastCalledWith(new Set(["a"]));
  });

  // Mutation: stamp before the files are fetched. A failed download would
  // say Downloaded with photos missing.
  it("stamps the plan downloaded only once its files are on the phone", async () => {
    api.getPlan.mockResolvedValue(view("a"));
    files.downloadPlanFiles.mockRejectedValueOnce(new Error("signal"));
    await expect(downloadPlan("a", () => {})).rejects.toThrow("signal");
    expect((await readCachedPlan("a"))?.downloadedAt).toBeNull();
    await downloadPlan("a", () => {});
    expect((await readCachedPlan("a"))?.downloadedAt).not.toBeNull();
  });
});

describe("planChanged", () => {
  const stamp = { updatedAt: "2026-10-01T00:00:00.000Z", downloadedAt: null };
  // Mutation: compare with `>=`, or treat a missing cached stamp as changed.
  it("is true only when the poll's plan is newer than the cached copy", () => {
    expect(planChanged({ updatedAt: "2026-10-02T00:00:00.000Z" }, stamp)).toBe(
      true,
    );
    expect(planChanged({ updatedAt: stamp.updatedAt }, stamp)).toBe(false);
    expect(planChanged({ updatedAt: stamp.updatedAt }, undefined)).toBe(false);
  });
});
