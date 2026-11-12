import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// expo-sqlite has no native runtime here: a recording stand-in stands in for
// the one connection, so the STATEMENTS can be asserted (which is where
// mirror-wipe bugs surface).
const wipeCalls: string[] = [];
const execCalls: string[] = [];
/** Columns this stand-in database claims each table already has. The gaps —
 * conflict_shelf.entity_name, plans_cache.downloaded_at — are an install that
 * predates each column, which is the case the column migration exists for. */
const GAPS: Record<string, string> = {
  conflict_shelf: "entity_name",
  plans_cache: "downloaded_at",
};
const existingColumns = (table: string): { name: string }[] => {
  const declared = Object.keys(tableSchema(table)?.columns ?? {});
  return declared
    .filter((name) => GAPS[table] !== name)
    .map((name) => ({ name }));
};
const nativeDb = {
  execAsync: (sql: string) => {
    execCalls.push(sql);
    return Promise.resolve();
  },
  runAsync: (sql: string) => {
    wipeCalls.push(sql);
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  },
  getFirstAsync: () => Promise.resolve(null),
  getAllAsync: (sql: string) => {
    const pragma = /^PRAGMA table_info\((\w+)\)$/.exec(sql);
    return Promise.resolve(pragma ? existingColumns(pragma[1]) : []);
  },
  withTransactionAsync: async (task: () => Promise<void>) => task(),
};
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: () => Promise.resolve(nativeDb),
}));

const { tableSchema } = await import("./mirrorSchema");
const { getSyncDb, withSyncTransaction, wipeMirror } = await import("./syncDb");

/** A stand-in for the one shared connection: BEGIN/COMMIT with no isolation,
 * exactly like expo-sqlite's own implementation. `depth > 1` is the nested
 * BEGIN that would roll back the other writer's transaction. */
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
    // The rule, enforced: a bare db.withTransactionAsync in src/sync,
    // src/tracks or src/offline is a writer outside the lock, which is the whole
    // bug back again (#694). Mutation: revert any of them to a bare call.
    const offenders: string[] = [];
    for (const dir of ["sync", "tracks", "offline"]) {
      const full = join(__dirname, "..", dir);
      for (const name of readdirSync(full)) {
        if (
          !name.endsWith(".ts") ||
          name === "syncDb.ts" ||
          name === "regionMbtiles.ts" || // exclusive transaction on its own connection
          name.endsWith(".test.ts")
        ) {
          continue;
        }
        const source = readFileSync(join(full, name), "utf8");
        if (source.includes(".withTransactionAsync(")) {
          offenders.push(`${dir}/${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("wipeMirror", () => {
  // Both halves of "the mirror is now empty".
  it("clears lastSyncAt with the cursor, so an empty mirror can't claim to be current", async () => {
    // applySchemaVersion documents the rule for the schema-reset path; a
    // server-forced reset is the same event. Keeping it would make
    // hasMirrorSynced() return true over nothing, suppressing the first-sync
    // error state when the post-reset pull fails.
    wipeCalls.length = 0;
    await wipeMirror();
    // (the first sync_state delete of the run is applySchemaVersion's, on the
    // lazily-opened database — take the wipe's own, which is the last)
    const stateDelete = wipeCalls.findLast((sql) =>
      sql.includes("FROM sync_state"),
    );
    expect(stateDelete).toContain("cursor");
    expect(stateDelete).toContain("applyFailedAt");
    expect(stateDelete).toContain("lastSyncAt");
  });

  it("spares rows a queued create op still names", async () => {
    // "Changes still waiting to upload are kept" is what the confirm promises.
    // An op survives a wipe, but a never-flushed create exists ONLY as its
    // optimistic mirror row — if deleted, the entity vanishes from every screen,
    // and offline nothing brings it back.
    wipeCalls.length = 0;
    await wipeMirror();
    const places = wipeCalls.find((sql) =>
      sql.startsWith("DELETE FROM places"),
    );
    expect(places).toContain(
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

describe("local-table migration", () => {
  // The mirror's drop-and-rebuild lever deliberately cannot touch the outbox,
  // the shelf or sync_state — dropping the outbox would destroy writes the
  // server has never seen — and CREATE TABLE IF NOT EXISTS does nothing to a
  // table that already exists. So a column added to a local table after it
  // shipped reaches an upgraded install through this path or not at all, and
  // "not at all" is silent: every read of it returns undefined.
  // A `keepOnReset` mirror table is never dropped either, so it takes the
  // same path. Mutation: skip `keepOnReset` tables in ensureLocalColumns.
  it("adds a declared column a never-dropped table is missing", async () => {
    await getSyncDb();
    const alters = execCalls.filter((sql) => sql.startsWith("ALTER TABLE"));
    expect(alters).toEqual([
      "ALTER TABLE conflict_shelf ADD COLUMN entity_name TEXT",
      "ALTER TABLE plans_cache ADD COLUMN downloaded_at TEXT",
    ]);
  });

  it("leaves the other mirror tables to the version lever", async () => {
    // A mirror table is rebuildable, so it is dropped and recreated rather than
    // altered; altering it here would be a second, divergent migration path.
    await getSyncDb();
    for (const sql of execCalls.filter((call) =>
      call.startsWith("ALTER TABLE"),
    )) {
      expect(sql).toMatch(
        /^ALTER TABLE (outbox|conflict_shelf|sync_state|plans_cache) /,
      );
    }
  });

  // If mirror tables are created up front, `CREATE INDEX ... ON media(origin)`
  // runs against the PREVIOUS version's media table, fails with "no such column",
  // and aborts the exec — before the drop-and-rebuild that adds the column.
  // The mirror would stay at the old shape and delta apply would fail on launch.
  it("creates mirror tables only AFTER the stale ones are dropped", async () => {
    await getSyncDb();
    // The first statement of the open must carry LOCAL tables and nothing else.
    // That is what leaves the drop reachable: a mirror CREATE (or, fatally, an
    // index on a column the old table lacks) issued here runs against last
    // version's schema.
    expect(execCalls[0]).toContain("CREATE TABLE IF NOT EXISTS sync_state");
    expect(execCalls[0]).not.toContain("CREATE TABLE IF NOT EXISTS media");
    expect(execCalls[0]).not.toContain("media(origin)");

    // ...and the mirror DDL is issued, later, in its own statement.
    const mirrorDdl = execCalls
      .slice(1)
      .find((sql) => sql.includes("media(origin)"));
    expect(mirrorDdl).toBeDefined();
    expect(mirrorDdl).toContain("CREATE TABLE IF NOT EXISTS media");
  });
});
