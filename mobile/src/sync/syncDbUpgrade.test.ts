// A phone on an earlier mirror schema opens a newer build: this runs that
// upgrade on a real SQLite instead of asserting which statements get issued.
//
// Two mechanisms meet here and `syncDb.test.ts` only sees them through a mock:
// the version lever DROPS and rebuilds the mirror tables, and
// `ensureLocalColumns` ALTERs the tables that are never dropped (the outbox
// holds writes the server has never seen). Either one throwing on open leaves
// every phone on the older build unable to open its own database.
//
// `LEGACY_DDL` is a frozen literal of the oldest shape this code still
// upgrades: the never-dropped tables before their added columns, and one stale
// mirror table. It is frozen on purpose: built from the declaration, a column
// deleted from the declaration would disappear from the old shape too.
//
// Mutation that turns it red: give a never-dropped table's declared column the
// DDL `TEXT NOT NULL` with no default (the ALTER throws), skip the
// `keepOnReset` tables in `ensureLocalColumns`, stop clearing the cursor in
// `dropStaleMirror`, or raise `MIRROR_SCHEMA_VERSION` without raising
// `REVIEWED_THROUGH` below.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MIRROR_SCHEMA_VERSION } from "./syncDb";
import { createSchemaSql } from "./mirrorSchema";

// The newest version whose upgrade this file has been checked against. A bump
// that changes a never-dropped table needs its old shape in LEGACY_DDL, the
// rest are covered by the rebuild; either way someone has to look.
const REVIEWED_THROUGH = 13;

const LEGACY_DDL = `
  CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT NOT NULL UNIQUE,
    entity TEXT NOT NULL,
    op TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    base_updated_at TEXT,
    fields_json TEXT,
    base_fields_json TEXT,
    state TEXT NOT NULL DEFAULT 'queued',
    media_phase TEXT,
    error_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE conflict_shelf (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TABLE plans_cache (
    plan_id TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    plan_updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE TABLE places (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  INSERT INTO sync_state (key, value) VALUES ('cursor', 'old-cursor');
  INSERT INTO outbox (op_id, entity, op, entity_id, created_at)
    VALUES ('op-1', 'place', 'create', 'place-1', '2026-01-01T00:00:00.000Z');
  INSERT INTO conflict_shelf (entity, entity_id, field, at)
    VALUES ('place', 'place-1', 'notes', '2026-01-01T00:00:00.000Z');
  INSERT INTO plans_cache (plan_id, fetched_at, plan_updated_at, payload_json)
    VALUES ('plan-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '{}');
  INSERT INTO places (id, name) VALUES ('place-1', 'Made-up gully');
`;

let sqlite = new DatabaseSync(":memory:");

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

type Column = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
};

/** Every table's columns, as `name type notnull default`, sorted. */
function shapeOf(db: DatabaseSync): Record<string, string[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  const out: Record<string, string[]> = {};
  for (const { name } of tables) {
    if (name.startsWith("sqlite_")) continue;
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as Column[];
    out[name] = columns
      .map((c) => `${c.name} ${c.type} ${c.notnull} ${String(c.dflt_value)}`)
      .sort();
  }
  return out;
}

const fresh = new DatabaseSync(":memory:");
fresh.exec(createSchemaSql());
const FRESH_SHAPE = shapeOf(fresh);

const EARLIER_VERSIONS = Array.from(
  { length: MIRROR_SCHEMA_VERSION - 1 },
  (_, i) => i + 1,
);

describe("the mirror database upgrade", () => {
  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
  });

  it("has an upgrade case for the current schema version", () => {
    expect(
      MIRROR_SCHEMA_VERSION,
      `MIRROR_SCHEMA_VERSION is ${MIRROR_SCHEMA_VERSION}: check what upgrading from ${MIRROR_SCHEMA_VERSION - 1} needs. If the bump changed a table that is never dropped (outbox, conflict_shelf, sync_state, a keepOnReset table), put its previous shape in LEGACY_DDL; then set REVIEWED_THROUGH in syncDbUpgrade.test.ts to ${MIRROR_SCHEMA_VERSION}`,
    ).toBe(REVIEWED_THROUGH);
    expect(EARLIER_VERSIONS.length).toBeGreaterThanOrEqual(1);
  });

  it.each(EARLIER_VERSIONS)(
    "upgrades a phone stamped at schema %i and keeps its unsent writes",
    async (version) => {
      sqlite.exec(LEGACY_DDL);
      sqlite
        .prepare("INSERT INTO sync_state (key, value) VALUES (?, ?)")
        .run("schemaVersion", String(version));

      vi.resetModules();
      const { getSyncDb } = await import("./syncDb");
      await getSyncDb();

      const upgraded = shapeOf(sqlite);
      for (const table of Object.keys(FRESH_SHAPE)) {
        expect(
          upgraded[table],
          `${table} after the upgrade differs from a fresh install: a declared column is missing from the upgrade path (mirrorSchema.ts, syncDb.ts)`,
        ).toEqual(FRESH_SHAPE[table]);
      }

      // The never-dropped tables keep what they held.
      expect(sqlite.prepare("SELECT op_id, state FROM outbox").all()).toEqual([
        { op_id: "op-1", state: "queued" },
      ]);
      expect(
        sqlite
          .prepare("SELECT entity_id, entity_name FROM conflict_shelf")
          .all(),
      ).toEqual([{ entity_id: "place-1", entity_name: null }]);
      expect(
        sqlite.prepare("SELECT plan_id, downloaded_at FROM plans_cache").all(),
      ).toEqual([{ plan_id: "plan-1", downloaded_at: null }]);

      // The rebuildable mirror was rebuilt empty and must refetch from zero.
      expect(sqlite.prepare("SELECT id FROM places").all()).toEqual([]);
      expect(
        sqlite
          .prepare("SELECT value FROM sync_state WHERE key = 'cursor'")
          .all(),
      ).toEqual([]);
      expect(
        sqlite
          .prepare("SELECT value FROM sync_state WHERE key = 'schemaVersion'")
          .get(),
      ).toEqual({ value: String(MIRROR_SCHEMA_VERSION) });
    },
  );
});
