// A phone on an earlier offline-database schema opens a newer build: this
// runs that upgrade on a real SQLite instead of reading the two lists.
//
// `schema.test.ts` checks that `ADDED_COLUMNS` and the CREATE TABLEs agree by
// name. It cannot see an ALTER that SQLite refuses (`INTEGER NOT NULL` with no
// default) or an entry that was never written, and either one throws or loses
// a column on every installed phone the first time it opens the new build.
//
// `LEGACY_DDL` is the oldest shape this code still upgrades: the three tables
// that have gained columns, as they were before any `ADDED_COLUMNS` entry. It
// is a frozen literal on purpose. Built from `SCHEMA_SQL` minus
// `ADDED_COLUMNS`, an entry deleted from the list would vanish from the old
// shape too, and nothing would notice. Each test then replays the first `k`
// entries onto it, so every release in between is also a starting point.
//
// Mutation that turns it red: give an `ADDED_COLUMNS` entry the definition
// `INTEGER NOT NULL` (the upgrade throws), or delete an entry from
// `ADDED_COLUMNS` (the upgraded table is missing that column).
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADDED_COLUMNS, SCHEMA_SQL } from "./schema";

const LEGACY_DDL = `
  CREATE TABLE map_artifact (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    logicalKey   TEXT NOT NULL,
    format       TEXT NOT NULL,
    sourceType   TEXT NOT NULL,
    path         TEXT NOT NULL,
    west REAL, south REAL, east REAL, north REAL,
    minzoom INTEGER, maxzoom INTEGER,
    sizeBytes    INTEGER NOT NULL,
    downloadedAt TEXT NOT NULL
  );
  CREATE TABLE track (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    state          TEXT NOT NULL,
    color          TEXT NOT NULL,
    visible        INTEGER NOT NULL DEFAULT 1,
    currentSegment INTEGER NOT NULL DEFAULT 0,
    distanceM      REAL NOT NULL DEFAULT 0,
    durationMs     INTEGER NOT NULL DEFAULT 0,
    elevationGainM REAL NOT NULL DEFAULT 0,
    elevationLossM REAL NOT NULL DEFAULT 0,
    pointCount     INTEGER NOT NULL DEFAULT 0,
    startedAt      TEXT NOT NULL,
    endedAt        TEXT,
    updatedAt      TEXT NOT NULL
  );
  CREATE TABLE track_point (
    trackId     TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    segment     INTEGER NOT NULL,
    lon REAL NOT NULL, lat REAL NOT NULL,
    altitudeM REAL, accuracyM REAL,
    timestampMs INTEGER NOT NULL,
    PRIMARY KEY (trackId, seq)
  );
  INSERT INTO map_artifact (id, kind, logicalKey, format, sourceType, path, sizeBytes, downloadedAt)
    VALUES ('artifact-1', 'region', 'made-up', 'pmtiles', 'built', 'a.pmtiles', 10, '2026-01-01T00:00:00.000Z');
  INSERT INTO track (id, name, state, color, startedAt, updatedAt)
    VALUES ('track-1', 'Made-up walk', 'finished', '#336699', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  INSERT INTO track_point (trackId, seq, segment, lon, lat, timestampMs)
    VALUES ('track-1', 0, 0, 150.4, -33.5, 1);
`;

let sqlite = new DatabaseSync(":memory:");

/** The subset of expo-sqlite's surface registryDb.ts uses, over node:sqlite. */
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
};
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: () => Promise.resolve(adapter),
}));
vi.mock("expo-file-system/legacy", () => ({}));

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
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as Column[];
    out[name] = columns
      .map((c) => `${c.name} ${c.type} ${c.notnull} ${String(c.dflt_value)}`)
      .sort();
  }
  return out;
}

const fresh = new DatabaseSync(":memory:");
fresh.exec(SCHEMA_SQL);
const FRESH_SHAPE = shapeOf(fresh);

async function openUpgraded() {
  vi.resetModules();
  const { getOfflineDb } = await import("./registryDb");
  await getOfflineDb();
}

describe("the offline database upgrade", () => {
  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
  });

  it("starts from a legacy shape that really lacks the added columns", () => {
    // Without this a typo in LEGACY_DDL would make every case below vacuous.
    sqlite.exec(LEGACY_DDL);
    const legacy = shapeOf(sqlite);
    expect(ADDED_COLUMNS.length).toBeGreaterThanOrEqual(10);
    for (const { table, column } of ADDED_COLUMNS) {
      expect(
        legacy[table]!.some((c) => c.startsWith(`${column} `)),
        `LEGACY_DDL already has ${table}.${column}`,
      ).toBe(false);
    }
  });

  // k = how many ADDED_COLUMNS entries the installed phone already has.
  it.each(ADDED_COLUMNS.map((_, k) => k))(
    "upgrades a phone that has the first %i added columns and keeps its rows",
    async (k) => {
      sqlite.exec(LEGACY_DDL);
      for (const { table, column, definition } of ADDED_COLUMNS.slice(0, k)) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }

      await openUpgraded();

      const upgraded = shapeOf(sqlite);
      for (const table of Object.keys(FRESH_SHAPE)) {
        expect(
          upgraded[table],
          `${table} after the upgrade differs from a fresh install: an ADDED_COLUMNS entry is missing or defined differently from its CREATE TABLE (schema.ts)`,
        ).toEqual(FRESH_SHAPE[table]);
      }

      // The rows the phone already held are still there, and the column that
      // has a DEFAULT took it.
      expect(
        sqlite.prepare("SELECT path, sizeBytes FROM map_artifact").all(),
      ).toEqual([{ path: "a.pmtiles", sizeBytes: 10 }]);
      expect(sqlite.prepare("SELECT name, pausedMs FROM track").all()).toEqual([
        { name: "Made-up walk", pausedMs: 0 },
      ]);
      expect(
        sqlite.prepare("SELECT lon, lat, speedMps FROM track_point").all(),
      ).toEqual([{ lon: 150.4, lat: -33.5, speedMps: null }]);
    },
  );
});
