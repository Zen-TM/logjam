// Plan §5.5 / §7.12 — the prod-snapshot privacy scrub cannot silently stop
// matching.
//
// `scripts/snapshot.sh` used to inline its scrub in a psql heredoc with no
// ON_ERROR_STOP. psql exits 0 after a statement error there and `set -e` does
// not catch it, so when `canyons` became `places` the scrub printed
// `relation "canyons" does not exist` and then exported a snapshot with every
// note intact — a mandatory privacy boundary failing OPEN, quietly.
//
// Two things are checked, because ON_ERROR_STOP only catches the first:
//  1. every table/column the scrub names still exists in the schema (a rename
//     breaks the build, not the next snapshot);
//  2. every user-authored column on the owner-data models is either scrubbed
//     or exempted BY NAME here (a new column cannot join the schema and miss
//     the scrub — root CLAUDE.md's "two lists that must agree" rule).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const scrubSql = readFileSync(
  join(REPO_ROOT, "scripts", "snapshot-scrub.sql"),
  "utf8",
);
const schema = readFileSync(
  join(REPO_ROOT, "api", "prisma", "schema.prisma"),
  "utf8",
);

/** Models holding what a user typed about where they have been. */
const OWNER_DATA_MODELS = ["Place", "Waypoint", "TripLog", "CustomFieldDef"];

/**
 * Columns on those models that are NOT scrubbed, each with the reason. An
 * entry here is a decision on the record; an omission is a test failure.
 */
const SCRUB_EXEMPT: Record<string, string> = {
  "places.import_key": "derived from name+coords, but opaque and needed for re-import dedupe",
  "places.ropewiki_snapshot": "public RopeWiki text, not user-authored",
  "waypoints.symbol": "never written by any code path (dropped in phase 1c)",
  "trip_logs.types": "free-text trip vocabulary, no location content",
  "trip_logs.import_key": "opaque",
  "custom_field_defs.key": "slug of the label, which IS scrubbed; kept so values stay addressable",
  "custom_field_defs.entity": "protocol vocabulary, not user text",
  "custom_field_defs.type": "protocol vocabulary, not user text",
};

/** `@@map("x")` for a model, else its snake-cased name. */
function tableOf(model: string): string {
  const body = modelBody(model);
  return /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model.toLowerCase();
}

function modelBody(model: string): string {
  const match = new RegExp(`^model ${model} \\{$([\\s\\S]*?)^\\}$`, "m").exec(schema);
  if (!match) throw new Error(`model ${model} not found in schema.prisma`);
  return match[1];
}

/** Scalar text/json columns, as their DB names. Relations and ids/FKs are
 *  excluded: they carry no free text and repointing them is not a scrub. */
function textColumns(model: string): string[] {
  const columns: string[] = [];
  for (const line of modelBody(model).split("\n")) {
    const field = /^\s{2}(\w+)\s+(String|Json)(\[\])?(\?)?(?:\s|$)/.exec(line);
    if (!field) continue;
    const [, name] = field;
    if (name === "id" || /Id$/.test(name)) continue;
    columns.push(/@map\("([^"]+)"\)/.exec(line)?.[1] ?? columnName(name));
  }
  return columns;
}

/**
 * The DB column for a field with no `@map`.
 *
 * Prisma does NOT snake_case automatically — an unmapped `altNames` is a column
 * literally called "altNames". This helper used to snake_case it, which made
 * the guard agree with a scrub that named a column that does not exist: both
 * sides shared one wrong assumption, so the test passed and the scrub would
 * have aborted on the next snapshot. Verbatim is the rule.
 */
const columnName = (field: string) => field;

/** (table, column) pairs the scrub assigns to. */
function scrubbedColumns(): Set<string> {
  const pairs = new Set<string>();
  // UPDATE <table> SET a = ..., b = ...  — up to the next statement.
  const statements = scrubSql.matchAll(
    /^UPDATE\s+(\w+)\s*\n?\s*SET([\s\S]*?);$/gim,
  );
  for (const [, table, assignments] of statements) {
    // A column may be double-quoted, and one of them has to be: Prisma leaves
    // an unmapped field name verbatim, so `altNames` is a camelCase identifier
    // that Postgres folds to lowercase unless it is quoted.
    for (const [, column] of assignments.matchAll(
      /(?:^|,)\s*"?([A-Za-z_]\w*)"?\s*=/g,
    )) {
      pairs.add(`${table}.${column}`);
    }
  }
  return pairs;
}

describe("snapshot-scrub.sql", () => {
  it("sets ON_ERROR_STOP, so a statement error aborts the snapshot", () => {
    expect(scrubSql).toMatch(/^\\set ON_ERROR_STOP on$/m);
  });

  it("names only tables that exist", () => {
    const tables = new Set(
      [...scrubSql.matchAll(/^UPDATE\s+(\w+)/gim)].map(([, t]) => t),
    );
    const mapped = new Set([...schema.matchAll(/@@map\("([^"]+)"\)/g)].map(([, t]) => t));
    for (const table of tables) {
      expect(mapped.has(table), `scrub targets unknown table "${table}"`).toBe(true);
    }
  });

  it("names only columns that exist", () => {
    const byTable = new Map<string, Set<string>>();
    for (const model of schema.matchAll(/^model (\w+) \{$/gm)) {
      const name = model[1];
      byTable.set(tableOf(name), new Set(allColumns(name)));
    }
    for (const pair of scrubbedColumns()) {
      const [table, column] = pair.split(".");
      const columns = byTable.get(table);
      expect(columns, `scrub targets unknown table "${table}"`).toBeDefined();
      expect(columns!.has(column), `scrub targets unknown column "${pair}"`).toBe(true);
    }
  });

  it("covers every user-authored column, or exempts it by name", () => {
    const scrubbed = scrubbedColumns();
    const unaccounted: string[] = [];
    for (const model of OWNER_DATA_MODELS) {
      for (const column of textColumns(model)) {
        const pair = `${tableOf(model)}.${column}`;
        if (scrubbed.has(pair) || pair in SCRUB_EXEMPT) continue;
        unaccounted.push(pair);
      }
    }
    expect(
      unaccounted,
      "these columns hold what a user typed and are neither scrubbed nor exempted " +
        "in SCRUB_EXEMPT — decide which, don't leave the snapshot to chance",
    ).toEqual([]);
  });

  it("has no stale exemptions", () => {
    const live = new Set(
      OWNER_DATA_MODELS.flatMap((model) =>
        textColumns(model).map((column) => `${tableOf(model)}.${column}`),
      ),
    );
    for (const pair of Object.keys(SCRUB_EXEMPT)) {
      expect(live.has(pair), `SCRUB_EXEMPT names "${pair}", which no longer exists`).toBe(true);
    }
  });
});

/** Every scalar column of a model, as DB names — for the existence check. */
function allColumns(model: string): string[] {
  const columns: string[] = [];
  for (const line of modelBody(model).split("\n")) {
    const field = /^\s{2}(\w+)\s+(\w+)(\[\])?(\?)?(?:\s|$)/.exec(line);
    if (!field) continue;
    columns.push(/@map\("([^"]+)"\)/.exec(line)?.[1] ?? columnName(field[1]));
  }
  return columns;
}
