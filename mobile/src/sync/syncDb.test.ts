import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// expo-sqlite has no native runtime here: a recording stand-in stands in for
// the one connection, so the STATEMENTS can be asserted (which is where the
// mirror-wipe bugs lived).
const wipeCalls: string[] = [];
const nativeDb = {
  execAsync: () => Promise.resolve(),
  runAsync: (sql: string) => {
    wipeCalls.push(sql);
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  },
  getFirstAsync: () => Promise.resolve(null),
  getAllAsync: () => Promise.resolve([]),
  withTransactionAsync: async (task: () => Promise<void>) => task(),
};
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: () => Promise.resolve(nativeDb) }));

const { withSyncTransaction, wipeMirror } = await import("./syncDb");

/** A stand-in for the one shared connection: BEGIN/COMMIT with no isolation,
 * exactly like expo-sqlite's own implementation. `depth > 1` is the nested
 * BEGIN that used to roll back the OTHER writer's transaction. */
function fakeDb(log: string[]) {
  let depth = 0;
  return {
    withTransactionAsync: async (task: () => Promise<void>) => {
      depth += 1;
      log.push(depth > 1 ? "NESTED BEGIN" : "BEGIN");
      try {
        await task();
        log.push("COMMIT");
      } finally {
        depth -= 1;
      }
    },
  } as never;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("withSyncTransaction", () => {
  it("serialises overlapping writers instead of nesting them", async () => {
    // The race: a delta page applies (long, many awaited native calls) while
    // the user drops a waypoint. Unserialised, the second BEGIN nests and its
    // rollback aborts the pull's transaction — or its COMMIT lands mid-page and
    // the cursor write ends up outside any transaction.
    const log: string[] = [];
    const db = fakeDb(log);

    const slow = withSyncTransaction(db, async () => {
      log.push("pull:start");
      await tick();
      await tick();
      log.push("pull:end");
    });
    const fast = withSyncTransaction(db, async () => {
      log.push("waypoint");
    });
    await Promise.all([slow, fast]);

    expect(log).not.toContain("NESTED BEGIN");
    expect(log).toEqual([
      "BEGIN",
      "pull:start",
      "pull:end",
      "COMMIT",
      "BEGIN",
      "waypoint",
      "COMMIT",
    ]);
  });

  it("lets the next writer through after one throws", async () => {
    const log: string[] = [];
    const db = fakeDb(log);

    const failing = withSyncTransaction(db, async () => {
      throw new Error("rolled back");
    });
    const next = withSyncTransaction(db, async () => {
      log.push("after");
      return 42;
    });

    await expect(failing).rejects.toThrow("rolled back");
    await expect(next).resolves.toBe(42);
    expect(log).toContain("after");
  });

  it("returns the task's value", async () => {
    await expect(
      withSyncTransaction(fakeDb([]), async () => "value"),
    ).resolves.toBe("value");
  });
});

describe("single-writer discipline", () => {
  it("is the only place sync code opens a transaction", () => {
    // The rule, enforced: a bare db.withTransactionAsync anywhere in src/sync
    // is a writer outside the lock, which is the whole bug back again.
    const offenders: string[] = [];
    for (const name of readdirSync(__dirname)) {
      if (!name.endsWith(".ts") || name === "syncDb.ts" || name.endsWith(".test.ts")) {
        continue;
      }
      const source = readFileSync(join(__dirname, name), "utf8");
      if (source.includes(".withTransactionAsync(")) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

describe("wipeMirror", () => {
  // Both halves of "the mirror is now empty", which the plain wipe got wrong.
  it("clears lastSyncAt with the cursor, so an empty mirror can't claim to be current", async () => {
    // applySchemaVersion documents the rule for the schema-reset path; a
    // server-forced reset is the same event. Keeping it made hasMirrorSynced()
    // return true over nothing, which suppressed the first-sync error state
    // when the post-reset pull failed.
    wipeCalls.length = 0;
    await wipeMirror();
    // (the first sync_state delete of the run is applySchemaVersion's, on the
    // lazily-opened database — take the wipe's own, which is the last)
    const stateDelete = wipeCalls.findLast((sql) => sql.includes("FROM sync_state"));
    expect(stateDelete).toContain("cursor");
    expect(stateDelete).toContain("applyFailedAt");
    expect(stateDelete).toContain("lastSyncAt");
  });

  it("spares rows a queued create op still names", async () => {
    // "Changes still waiting to upload are kept" is what the confirm promises.
    // The op survived a wipe, but a never-flushed create exists ONLY as its
    // optimistic mirror row — so the entity vanished from every screen, and
    // offline nothing brought it back.
    wipeCalls.length = 0;
    await wipeMirror();
    const canyons = wipeCalls.find((sql) => sql.startsWith("DELETE FROM canyons"));
    expect(canyons).toContain(
      "id NOT IN (SELECT entity_id FROM outbox WHERE op = 'create')",
    );
  });

  it("still empties the keyless notification cache", async () => {
    // notifications_cache has no id column, so the exemption cannot apply —
    // and it is a verbatim server response, rebuilt by a refetch.
    wipeCalls.length = 0;
    await wipeMirror();
    expect(wipeCalls).toContain("DELETE FROM notifications_cache");
  });
});
