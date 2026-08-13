import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MIRROR_TABLES, SYNC_TABLES, createSchemaSql, tableSchema } from "./mirrorSchema";
import { OUTBOX_ENTITIES, outboxMirrorTable } from "./outboxTables";

// The regression this file exists for: a tombstone cascade wrote
// `waypoints.canyon_id`, a column the schema had stopped declaring. Nothing
// caught it — typecheck can't see inside a SQL string, and no test ever opened
// the real database — so the first canyon delete an account saw rolled back the
// delta transaction, took the cursor write with it, and froze sync forever on
// every fresh install. The suite was green throughout.
//
// So: read the SQL, and check every column it names against the one schema
// declaration. Cheap, and it fails on the day someone renames a column.

const SYNC_DIR = __dirname;

const SQL_KEYWORDS = new Set([
  "and", "or", "not", "null", "in", "is", "like", "between", "by", "asc",
  "desc", "collate", "nocase", "select", "from", "where", "set", "values",
  "into", "insert", "update", "delete", "replace", "count", "max", "min",
  "sum", "group", "order", "limit", "offset", "as", "on", "distinct", "case",
  "when", "then", "else", "end", "exists", "union", "all",
]);

function sourceFiles(): string[] {
  return readdirSync(SYNC_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(SYNC_DIR, name));
}

/** SQL-looking string/template literals, minus any built by interpolation
 * (a `${table}` name can't be checked statically — those call sites take the
 * table from this schema anyway). */
function sqlLiterals(source: string): string[] {
  const literals = source.match(/`[^`]*`|"[^"\n]*"/g) ?? [];
  return literals
    .map((literal) => literal.slice(1, -1))
    .filter((sql) => /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql))
    .filter((sql) => !sql.includes("${"));
}

function identifiers(fragment: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of fragment.matchAll(pattern)) {
    const name = match[1];
    if (!SQL_KEYWORDS.has(name.toLowerCase())) found.push(name);
  }
  return found;
}

/** The single table a statement touches (null when it names none or several —
 * a join would need real parsing, and the sync path has none). */
function tableOf(sql: string): string | null {
  const names = new Set(
    [...sql.matchAll(/(?:INSERT\s+(?:OR\s+REPLACE\s+)?INTO|UPDATE|FROM)\s+(\w+)/gi)].map(
      (match) => match[1],
    ),
  );
  return names.size === 1 ? [...names][0] : null;
}

function columnsOf(sql: string): string[] {
  const columns: string[] = [];

  const insert = sql.match(/INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+\w+\s*\(([^)]*)\)/i);
  if (insert) {
    columns.push(...insert[1].split(",").map((name) => name.trim()).filter(Boolean));
  }

  const set = sql.match(/\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/i);
  if (set) columns.push(...identifiers(set[1], /(\w+)\s*=/g));

  const where = sql.match(/\bWHERE\b([\s\S]*?)(?:\bORDER\b|\bGROUP\b|\bLIMIT\b|$)/i);
  if (where) {
    columns.push(...identifiers(where[1], /(\w+)\s*(?:=|<|>|!=|\bIN\b|\bLIKE\b|\bIS\b)/gi));
  }

  const select = sql.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
  if (select) {
    for (const item of select[1].split(",")) {
      const name = item.trim();
      if (/^\w+$/.test(name) && !SQL_KEYWORDS.has(name.toLowerCase())) columns.push(name);
    }
  }

  const ordering = sql.match(/\b(?:ORDER|GROUP)\s+BY\b([\s\S]*?)(?:\bLIMIT\b|$)/i);
  if (ordering) columns.push(...identifiers(ordering[1], /(\w+)/g));

  return columns;
}

describe("mirror SQL vs the schema declaration", () => {
  it("names only columns the schema declares", () => {
    const offences: string[] = [];
    for (const file of sourceFiles()) {
      for (const sql of sqlLiterals(readFileSync(file, "utf8"))) {
        const table = tableOf(sql);
        const schema = table ? tableSchema(table) : undefined;
        if (!schema) continue;
        for (const column of columnsOf(sql)) {
          if (!(column in schema.columns)) {
            offences.push(`${file.split("/").pop()}: ${table}.${column} — ${sql.trim()}`);
          }
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("actually looks at the statements", () => {
    // A scanner that silently matches nothing would pass the test above
    // forever. Prove it reads the real cascade, and that it would have caught
    // the dropped column.
    const tombstone = sqlLiterals(
      readFileSync(join(SYNC_DIR, "mirrorStore.ts"), "utf8"),
    );
    expect(tombstone.length).toBeGreaterThan(10);
    expect(columnsOf("UPDATE waypoints SET canyon_id = NULL WHERE canyon_id = ?")).toContain(
      "canyon_id",
    );
    expect("canyon_id" in tableSchema("waypoints")!.columns).toBe(false);
  });
});

describe("the wipe derives from the schema", () => {
  it("holds every mirror table, routes included", () => {
    // `routes` was added to the schema and never to the wipe list, so sign-out
    // and account-switch left the previous user's route geometry — their
    // coordinates through canyons — on the phone for the next user's map.
    const names = MIRROR_TABLES.map((table) => table.name);
    expect(names).toContain("routes");
    expect(names).toContain("waypoints");
    expect(names).toContain("canyons");
  });

  it("keeps unsent local work out of the mirror set", () => {
    // A mirror reset drops these tables; the outbox holds writes the server has
    // never seen and must survive one.
    const names = MIRROR_TABLES.map((table) => table.name);
    expect(names).not.toContain("outbox");
    expect(names).not.toContain("conflict_shelf");
    expect(names).not.toContain("sync_state");
  });

  it("has a declared table for every entity the outbox can orphan", () => {
    // The drift guard: an entity gains an outbox mapping, so it has a table,
    // so the wipe must know about it.
    for (const entity of OUTBOX_ENTITIES) {
      const table = outboxMirrorTable(entity);
      if (table === null) continue;
      expect(tableSchema(table)).toBeDefined();
    }
  });

  it("creates every declared table", () => {
    const ddl = createSchemaSql();
    for (const table of SYNC_TABLES) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${table.name} (`);
      for (const column of Object.keys(table.columns)) {
        expect(ddl).toContain(`  ${column} `);
      }
    }
  });
});
