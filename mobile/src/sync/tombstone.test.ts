import { beforeEach, describe, expect, it, vi } from "vitest";

// The canyon tombstone cascade — the code path that killed sync on every fresh
// install. It ran `UPDATE waypoints SET canyon_id = NULL`, a column the schema
// stopped declaring when waypoint→canyon links went many-to-many, so the whole
// delta transaction rolled back, the cursor never advanced, and the same page
// re-failed every cycle forever.
//
// getSyncDb reaches for expo-sqlite (no native runtime here), so the database
// is a recording stand-in: this asserts the STATEMENTS, which is where the bug
// was. Column existence is checked against the schema in mirrorSchema.test.ts.

type Call = { sql: string; args: unknown[] };
const calls: Call[] = [];
let waypointRows: { id: string; canyon_ids_json: string | null }[] = [];
let tripRows: { id: string; canyons_json: string | null }[] = [];

const DEAD = "dead-canyon";

const db = {
  runAsync: (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getFirstAsync: () => Promise.resolve(null),
  getAllAsync: (sql: string) => {
    calls.push({ sql, args: [] });
    if (sql.includes("FROM waypoints")) return Promise.resolve(waypointRows);
    if (sql.includes("FROM trip_logs")) return Promise.resolve(tripRows);
    return Promise.resolve([]);
  },
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<void>) => task(),
}));

vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: () => Promise.resolve(),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));

const { applyTombstone } = await import("./mirrorStore");
const { deleteCanyonLocal } = await import("./outbox");

function sqlText(): string {
  return calls.map((call) => call.sql).join("\n");
}

describe("canyon tombstone cascade", () => {
  beforeEach(() => {
    calls.length = 0;
    waypointRows = [
      { id: "wp-linked", canyon_ids_json: JSON.stringify([DEAD, "other"]) },
      { id: "wp-substring", canyon_ids_json: JSON.stringify(["dead-canyon-2"]) },
    ];
    tripRows = [{ id: "trip-1", canyons_json: JSON.stringify([{ id: DEAD, name: "X" }]) }];
  });

  it("never writes the m2m column that no longer exists", async () => {
    await applyTombstone(db as never, { type: "canyon", id: DEAD });
    expect(sqlText()).not.toMatch(/UPDATE waypoints SET canyon_id\b/);
  });

  it("takes the dead canyon out of each waypoint's link list", async () => {
    await applyTombstone(db as never, { type: "canyon", id: DEAD });
    const update = calls.find((call) =>
      call.sql.includes("UPDATE waypoints SET canyon_ids_json"),
    );
    expect(update).toBeDefined();
    expect(update!.args).toEqual([JSON.stringify(["other"]), "wp-linked"]);
  });

  it("leaves a row the LIKE prefilter matched by substring untouched", async () => {
    await applyTombstone(db as never, { type: "canyon", id: DEAD });
    const updates = calls.filter((call) =>
      call.sql.includes("UPDATE waypoints SET canyon_ids_json"),
    );
    expect(updates).toHaveLength(1);
  });

  it("scrubs the trip link list in its own {id,name} shape", async () => {
    await applyTombstone(db as never, { type: "canyon", id: DEAD });
    const update = calls.find((call) =>
      call.sql.includes("UPDATE trip_logs SET canyons_json"),
    );
    expect(update!.args).toEqual(["[]", "trip-1"]);
  });

  it("still deletes the canyon, its media, its shares and nulls route links", async () => {
    await applyTombstone(db as never, { type: "canyon", id: DEAD });
    const text = sqlText();
    expect(text).toContain("DELETE FROM canyons WHERE id = ?");
    expect(text).toContain("DELETE FROM media WHERE linked_type = 'canyon'");
    expect(text).toContain("DELETE FROM canyon_shares WHERE canyon_id = ?");
    expect(text).toContain("UPDATE routes SET canyon_id = NULL");
  });

  it("drops a pending local delete and parks the other pending ops", async () => {
    await applyTombstone(db as never, { type: "canyon", id: DEAD });
    const text = sqlText();
    expect(text).toContain("DELETE FROM outbox WHERE entity_id = ? AND op = 'delete'");
    expect(text).toContain("UPDATE outbox SET state = 'deadRemote'");
  });
});

describe("deleteCanyonLocal runs the SAME cascade as the tombstone", () => {
  // The divergence this pins: the local delete used to scrub links and shares
  // only, so the canyon's media rows (and their cached blobs) and any route
  // pointing at it survived until a later delta pull tidied up — i.e. forever
  // for a guest, whose device is never registered for pulls at all.
  beforeEach(() => {
    calls.length = 0;
    waypointRows = [];
    tripRows = [];
  });

  it("deletes the canyon's media rows, shares and route links", async () => {
    await deleteCanyonLocal(DEAD);
    const text = sqlText();
    expect(text).toContain("DELETE FROM canyons WHERE id = ?");
    expect(text).toContain("DELETE FROM media WHERE linked_type = 'canyon'");
    expect(text).toContain("DELETE FROM canyon_shares WHERE canyon_id = ?");
    expect(text).toContain("UPDATE routes SET canyon_id = NULL");
  });

  it("still queues the canyon delete op", async () => {
    await deleteCanyonLocal(DEAD);
    const op = calls.find((call) => call.sql.includes("INSERT INTO outbox"));
    expect(op).toBeDefined();
    expect(op!.args).toContain("canyon");
    expect(op!.args).toContain("delete");
  });

  it("issues every statement the tombstone cascade issues", async () => {
    await applyTombstone(db as never, { type: "canyon", id: DEAD });
    const tombstoneSql = calls
      .map((call) => call.sql)
      // The tombstone additionally reconciles the outbox; the local delete
      // owns its own op planning, so compare the MIRROR statements only.
      .filter((sql) => !sql.includes("outbox"));
    expect(tombstoneSql.length).toBeGreaterThan(3); // the scan really ran
    calls.length = 0;
    await deleteCanyonLocal(DEAD);
    const localSql = new Set(calls.map((call) => call.sql));
    expect(tombstoneSql.filter((sql) => !localSql.has(sql))).toEqual([]);
  });
});
