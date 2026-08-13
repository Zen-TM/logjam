import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// expo-sqlite has no native runtime here, and withSyncTransaction takes its
// database as an argument, so the module only needs to LOAD.
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: () => Promise.reject(new Error("no native db")) }));

const { withSyncTransaction } = await import("./syncDb");

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
