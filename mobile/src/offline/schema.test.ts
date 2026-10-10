// The check behind schema.ts's own rule: a column has to be in BOTH lists.
//
// A column added only to CREATE TABLE exists on fresh installs and is missing
// on every upgraded device; a column added only to ADDED_COLUMNS is the
// mirror, and both break at a distance from the edit. This asserts the pair
// agrees, which is the failure root CLAUDE.md records having shipped once.
import { describe, expect, it } from "vitest";

import { ADDED_COLUMNS, SCHEMA_SQL } from "./schema";
import { OFFLINE_TABLES } from "./wipedStores";

/** Column names declared in `CREATE TABLE <name> ( ... )`, per table. */
function createTableColumns(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  // Comments go FIRST: the table pattern stops at the next `;`, so a single
  // semicolon inside a `--` comment used to truncate that table's column set
  // and quietly make the ADDED_COLUMNS check below vacuous for it.
  const code = sql.replace(/--.*$/gm, "");
  const pattern = /CREATE TABLE IF NOT EXISTS (\w+) \(([^;]*?)\n\s*\);/g;
  for (const [, table, body] of code.matchAll(pattern)) {
    const columns = new Set<string>();
    for (const line of body!.split("\n")) {
      // Strip comments, then take every `name TYPE` pair on the line — several
      // columns share a line in places (`west REAL, south REAL, ...`).
      const code = line.replace(/--.*$/, "").trim();
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(code)) continue;
      for (const [, name] of code.matchAll(
        /(?:^|,)\s*(\w+)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/gi,
      )) {
        columns.add(name!);
      }
    }
    tables.set(table!, columns);
  }
  return tables;
}

describe("offline schema", () => {
  const tables = createTableColumns(SCHEMA_SQL);

  it("parses the tables it is asked to check", () => {
    // Guards the regex above: a rewrite that stops matching would make every
    // assertion below vacuous.
    expect(tables.get("track_point")).toContain("timestampMs");
    expect(tables.get("map_artifact")).toContain("groupLabel");
    expect(tables.size).toBeGreaterThanOrEqual(6);
  });

  it("declares every added column in CREATE TABLE as well", () => {
    for (const { table, column } of ADDED_COLUMNS) {
      expect(tables.get(table), `${table} is not created`).toBeDefined();
      expect(
        tables.get(table)!.has(column),
        `${table}.${column} is in ADDED_COLUMNS but not in CREATE TABLE — an upgraded device would get it and a fresh install would not`,
      ).toBe(true);
    }
  });

  it("adds each column at most once", () => {
    const seen = ADDED_COLUMNS.map(({ table, column }) => `${table}.${column}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

// MOT-001: OFFLINE_TABLES (wipedStores.ts, which wipeLocalData.ts clears) vs
// the CREATE TABLEs above is a THIRD hand-kept pair, beside ADDED_COLUMNS, with
// its own drift history — `track_point_rejected` (lon/lat of every rejected
// fix) joined SCHEMA_SQL without joining OFFLINE_TABLES, so those coordinates
// survived the account-transition wipe on a shared phone. `wipedStores.test.ts`
// holds the same pair together for the sign-out confirmation as well.
describe("the sign-out wipe covers every table this schema creates", () => {
  it("wipes every table SCHEMA_SQL creates", () => {
    const created = [...createTableColumns(SCHEMA_SQL).keys()];
    expect(created.length).toBeGreaterThan(0);
    const missing = created.filter(
      (table) => !(OFFLINE_TABLES as readonly string[]).includes(table),
    );
    expect(missing).toEqual([]);
  });

  it("holds the table the audit found leaking", () => {
    expect(OFFLINE_TABLES).toContain("track_point_rejected");
  });
});
