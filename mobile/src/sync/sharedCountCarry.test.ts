import { describe, expect, it, vi } from "vitest";

// The "absent field = unchanged" contract for sharedCount (shared/src/sync.ts):
// the flush path re-applies a server-confirmed write response that OMITS
// sharedCount, and INSERT OR REPLACE must not null the column (which vanishes
// the "Shared with N" pill). upsertWaypoint/upsertRoute therefore carry the
// stored count forward when the incoming row lacks the field.
//
// getSyncDb reaches for expo-sqlite (no native runtime here), so the database
// is a recording stand-in — same pattern as tombstone.test.ts.

type Call = { sql: string; args: unknown[] };
const calls: Call[] = [];
let storedWaypointCount: { shared_count: number | null } | null = null;
let storedRouteCount: { shared_count: number | null } | null = null;

const db = {
  runAsync: (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getFirstAsync: (sql: string) => {
    calls.push({ sql, args: [] });
    if (sql.includes("FROM waypoints")) return Promise.resolve(storedWaypointCount);
    if (sql.includes("FROM routes")) return Promise.resolve(storedRouteCount);
    return Promise.resolve(null);
  },
  getAllAsync: () => Promise.resolve([]),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<void>) => task(),
}));

const { upsertWaypoint, upsertRoute } = await import("./mirrorStore");

const waypointRow = {
  id: "wp-1",
  ownerId: "u1",
  canyonIds: [],
  tags: [],
  syncRole: "owner" as const,
  name: "Carpark",
  latitude: -33.5,
  longitude: 150.4,
  elevation: null,
  symbol: null,
  notes: null,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

const routeRow = {
  id: "rt-1",
  ownerId: "u1",
  canyonId: null,
  name: "Descent",
  color: "#ff0000",
  points: [
    [150.4, -33.5],
    [150.41, -33.51],
  ] as [number, number][],
  anchors: null,
  syncRole: "owner" as const,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

function lastUpsert(entity: "waypoints" | "routes"): Call {
  const upsert = calls
    .slice()
    .reverse()
    .find((c) => c.sql.includes(entity));
  if (!upsert) throw new Error(`no INSERT for ${entity}`);
  return upsert;
}

describe("sharedCount carry-forward (absent = unchanged)", () => {
  it("keeps a stored waypoint count when the incoming row omits it", async () => {
    storedWaypointCount = { shared_count: 2 };
    calls.length = 0;
    await upsertWaypoint(db as never, waypointRow, []);
    // 12th positional value (index 11) is shared_count.
    expect(lastUpsert("waypoints").args[11]).toBe(2);
  });

  it("writes 0 (not the stored count) when the incoming row says 0", async () => {
    storedWaypointCount = { shared_count: 2 };
    calls.length = 0;
    await upsertWaypoint(db as never, { ...waypointRow, sharedCount: 0 }, []);
    expect(lastUpsert("waypoints").args[11]).toBe(0);
  });

  it("writes null when the incoming row omits it and nothing is stored", async () => {
    storedWaypointCount = null;
    calls.length = 0;
    await upsertWaypoint(db as never, waypointRow, []);
    expect(lastUpsert("waypoints").args[11]).toBeNull();
  });

  it("keeps a stored route count when the incoming row omits it", async () => {
    storedRouteCount = { shared_count: 3 };
    calls.length = 0;
    await upsertRoute(db as never, routeRow, []);
    // 9th positional value (index 8) is shared_count.
    expect(lastUpsert("routes").args[8]).toBe(3);
  });
});
