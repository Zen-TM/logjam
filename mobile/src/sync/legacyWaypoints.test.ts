import { beforeEach, describe, expect, it, vi } from "vitest";

// The Stage 7 → Stage 8 waypoint promotion. Two SQLite FILES are involved
// (logjam-offline.db holds the legacy rows, logjam.db the mirror + outbox), so
// no transaction can span the "insert the new waypoint" / "delete the legacy
// row" pair. A kill in that window used to promote the row AGAIN on the next
// launch — the user saw duplicate waypoints, both queued for push. The fix is
// a deterministic id: the promoted waypoint keeps the legacy one.

type Call = { sql: string; args: unknown[] };

const mirrorCalls: Call[] = [];
const legacyCalls: Call[] = [];
let legacyRows: { id: string; name: string; lon: number; lat: number }[] = [];
let legacyTableExists = true;
/** Ids already in the mirror — what a half-finished previous run left behind. */
let mirrorWaypointIds = new Set<string>();

const mirrorDb = {
  runAsync: (sql: string, ...args: unknown[]) => {
    mirrorCalls.push({ sql, args });
    if (sql.includes("INSERT INTO waypoints")) {
      mirrorWaypointIds.add(args[0] as string);
    }
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getFirstAsync: (sql: string, ...args: unknown[]) => {
    if (sql.includes("FROM waypoints")) {
      const id = args[0] as string;
      return Promise.resolve(mirrorWaypointIds.has(id) ? { id } : null);
    }
    return Promise.resolve(null);
  },
  getAllAsync: () => Promise.resolve([]),
};

const legacyDb = {
  runAsync: (sql: string, ...args: unknown[]) => {
    legacyCalls.push({ sql, args });
    if (sql.includes("DELETE FROM waypoint")) {
      legacyRows = legacyRows.filter((row) => row.id !== args[0]);
    }
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  execAsync: (sql: string) => {
    legacyCalls.push({ sql, args: [] });
    if (sql.includes("DROP TABLE")) legacyTableExists = false;
    return Promise.resolve();
  },
  getFirstAsync: (sql: string) => {
    legacyCalls.push({ sql, args: [] });
    if (sql.includes("sqlite_master")) {
      return Promise.resolve(legacyTableExists ? { name: "waypoint" } : null);
    }
    return Promise.resolve(null);
  },
  getAllAsync: (sql: string) => {
    legacyCalls.push({ sql, args: [] });
    return Promise.resolve(legacyRows);
  },
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(mirrorDb),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<unknown>) => task(),
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({ deleteAsync: () => Promise.resolve() }));
vi.mock("expo-crypto", () => ({
  randomUUID: () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }),
}));
vi.mock("../offline/registryDb", () => ({
  getOfflineDb: () => Promise.resolve(legacyDb),
}));

const { migrateLegacyWaypoints } = await import("./outbox");

const LEGACY_ID = "11111111-1111-4111-8111-111111111111";

function promotedIds(): string[] {
  return mirrorCalls
    .filter((call) => call.sql.includes("INSERT INTO waypoints"))
    .map((call) => call.args[0] as string);
}

describe("migrateLegacyWaypoints", () => {
  beforeEach(() => {
    mirrorCalls.length = 0;
    legacyCalls.length = 0;
    mirrorWaypointIds = new Set();
    legacyTableExists = true;
    legacyRows = [{ id: LEGACY_ID, name: "Notch", lon: 150.4, lat: -33.5 }];
  });

  it("promotes a legacy row under its own id", async () => {
    await migrateLegacyWaypoints();
    expect(promotedIds()).toEqual([LEGACY_ID]);
  });

  it("does not duplicate when a kill lost the legacy DELETE", async () => {
    // Simulate the crash window: the mirror insert landed, the legacy row
    // survived. The next launch must NOT mint a second waypoint.
    mirrorWaypointIds.add(LEGACY_ID);
    await migrateLegacyWaypoints();
    expect(promotedIds()).toEqual([]);
    expect(
      legacyCalls.some((call) => call.sql.includes("DELETE FROM waypoint")),
    ).toBe(true);
  });

  it("drops the legacy table once drained, so it never returns", async () => {
    await migrateLegacyWaypoints();
    expect(legacyCalls.some((call) => call.sql.includes("DROP TABLE"))).toBe(true);
  });

  it("is a no-op on a fresh install, where the table was never created", async () => {
    legacyTableExists = false;
    await migrateLegacyWaypoints();
    expect(mirrorCalls).toEqual([]);
    expect(legacyCalls.some((call) => call.sql.includes("FROM waypoint "))).toBe(
      false,
    );
  });

  it("mints a fresh id for a legacy id the push protocol would reject", async () => {
    // Non-UUIDv4 ids can't be pushed at all (parsePushOp is strict), so those
    // rows accept the narrow duplicate window rather than a permanent 400.
    legacyRows = [{ id: "wp-7", name: "Old", lon: 150.4, lat: -33.5 }];
    await migrateLegacyWaypoints();
    expect(promotedIds()).toHaveLength(1);
    expect(promotedIds()[0]).not.toBe("wp-7");
  });
});
