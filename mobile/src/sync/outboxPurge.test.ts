// Plan §7.14 — the mirror version bump must not leave the outbox holding ops
// the protocol no longer accepts.
//
// `dropStaleMirror` spares the `local` tables on purpose (the outbox holds
// writes the server has never seen), so a bump that RENAMES an entity leaves
// `entity: "canyon"` ops queued forever: parsePushOp answers
// `ops[i].entity is invalid`, the op parks in the conflict shelf, and the user
// has no way to clear it. This runs the real getSyncDb path against a real
// SQLite so the assertion is about rows, not about a statement being issued.
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it, vi } from "vitest";

const { createSchemaSql } = await import("./mirrorSchema");

const sqlite = new DatabaseSync(":memory:");

/** The subset of expo-sqlite's surface syncDb.ts uses, over node:sqlite. */
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

const queued = (entity: string, opId: string) =>
  sqlite
    .prepare(
      `INSERT INTO outbox (op_id, entity, op, entity_id, created_at)
       VALUES (?, ?, 'create', ?, '2026-09-05T00:00:00.000Z')`,
    )
    .run(opId, entity, `id-${opId}`);

beforeAll(async () => {
  // An install from before the rework: the local tables at their shipped shape,
  // stamped at the previous mirror version, with writes still queued.
  sqlite.exec(createSchemaSql("local"));
  sqlite
    .prepare("INSERT INTO sync_state (key, value) VALUES ('schemaVersion', '4')")
    .run();
  queued("canyon", "op-canyon");
  queued("waypoint", "op-waypoint");
  queued("place", "op-place");
  sqlite
    .prepare(
      `INSERT INTO conflict_shelf (entity, entity_id, field, at)
       VALUES (?, 'c1', 'notes', '2026-09-05T00:00:00.000Z')`,
    )
    .run("canyon");

  const { getSyncDb } = await import("./syncDb");
  await getSyncDb();
});

describe("mirror version bump purges dead-vocabulary ops", () => {
  it("drops queued ops whose entity the protocol no longer has", () => {
    const entities = sqlite
      .prepare("SELECT entity FROM outbox ORDER BY entity")
      .all()
      .map((row) => (row as { entity: string }).entity);
    expect(entities).not.toContain("canyon");
  });

  it("keeps queued ops the protocol still accepts", () => {
    const entities = sqlite
      .prepare("SELECT entity FROM outbox ORDER BY entity")
      .all()
      .map((row) => (row as { entity: string }).entity);
    expect(entities).toEqual(["place", "waypoint"]);
  });

  it("clears the conflict shelf of the same dead entities", () => {
    const rows = sqlite.prepare("SELECT entity FROM conflict_shelf").all();
    expect(rows).toEqual([]);
  });
});
