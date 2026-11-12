// The prod-snapshot privacy scrub cannot silently stop matching.
//
// psql exits 0 after a statement error in a heredoc unless ON_ERROR_STOP is
// set; without it, `set -e` does not catch failures and an unmapped table or
// column name would export a snapshot with user notes intact — a mandatory
// privacy boundary failing open, quietly.
//
// Two things are checked, because ON_ERROR_STOP only catches the first:
//  1. every table/column the scrub names still exists in the schema (a rename
//     breaks the build, not the next snapshot);
//  2. every text or Json column of EVERY model in schema.prisma is, by name,
//     either scrubbed or safe with a reason (a new column cannot join the
//     schema and miss the scrub — root AGENTS.md's "two lists that must
//     agree" rule), and each scrubbed one is assigned in the SQL.
// CI's `migration-upgrade` job runs the SQL itself over the seed
// (scripts/snapshot-scrub-canary.sh); this file holds the declaration both read.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRIP_TYPE_SUGGESTIONS } from "@logjam/shared";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const scrubSql = readFileSync(
  join(REPO_ROOT, "scripts", "snapshot-scrub.sql"),
  "utf8",
);
const schema = readFileSync(
  join(REPO_ROOT, "api", "prisma", "schema.prisma"),
  "utf8",
);

/**
 * Every text or Json column of every model, as `table.column`, is declared
 * once: SCRUBBED (the SQL must assign it) or SAFE under a reason. A column a
 * relation points at, and `id`, are not listed: they are ids, and repointing
 * one is not a scrub. A new column fails the test until it is added to one.
 *
 * `users.ui_preferences` is scrubbed by removing keys, not by blanking it: the
 * rest is settings (theme, regions, opt-ins), not text a user typed.
 */
const SCRUBBED = [
  "users.subject",
  "users.username",
  "users.email",
  "users.ui_preferences",
  "custom_field_defs.label",
  "custom_field_defs.trip_types",
  "place_types.name",
  "places.type_name",
  "places.name",
  "places.altNames",
  "places.notes",
  "places.gauge_id",
  "places.field_values",
  "places.foreign_fields",
  "import_snapshots.before",
  "import_snapshots.after",
  "trip_logs.display_name",
  "trip_logs.types",
  "trip_logs.notes",
  "trip_logs.custom_fields",
  "media.filename",
  "media.display_name",
  "routes.name",
  "topo_jobs.name",
  "topo_templates.name",
  "device_tokens.token",
  "file_sends.filename",
  "trip_plans.name",
  "trip_plans.trip_types",
  "trip_plan_sections.title",
  "trip_plan_sections.body",
  "trip_plan_forms.title",
  "trip_plan_forms.questions",
  "trip_plan_answers.answers",
  "notifications.payload",
];

/** Columns the scrub leaves alone, grouped by the reason they are no leak. */
const SAFE: Record<string, string[]> = {
  "protocol or app vocabulary, not user text": [
    "users.consent_version",
    "custom_field_defs.entity",
    "custom_field_defs.key",
    "custom_field_defs.type",
    "place_types.icon_key",
    "place_types.color",
    "places.type_icon_key",
    "notifications.type",
    "media.linked_type",
    "media.media_type",
    "media.color",
    "routes.color",
    "media.origin",
    "friendships.status",
    "topo_jobs.status",
    "topo_export_jobs.format",
    "topo_export_jobs.bundling",
    "topo_export_jobs.status",
    "sync_tombstones.entity_type",
    "device_tokens.platform",
    "shares.entity_type",
    "file_sends.source_kind",
    "file_send_recipients.status",
    "trip_plan_members.role",
    "trip_plan_members.status",
    "trip_plan_forms.preset",
    "trip_plan_forms.visible_to",
  ],
  "opaque ids, keys and hashes: no words, and a dev needs them to join rows": [
    "places.import_key",
    "places.import_batch_id",
    "import_snapshots.batch_id",
    "trip_logs.import_key",
    "trip_logs.import_batch_id",
    "media.linked_id",
    "media.source_media_id",
    "media.s3_key_thumbnail",
    "media.s3_key_display",
    "friend_invites.token_hash",
    "topo_jobs.s3_input_key",
    "topo_jobs.s3_output_keys",
    "topo_jobs.ecs_task_arn",
    "topo_export_jobs.source_job_ids",
    "topo_export_jobs.result_key",
    "topo_export_jobs.ecs_task_arn",
    "sync_tombstones.entity_id",
    "shares.entity_id",
    "file_sends.s3_key",
    "egress_log_cursors.prefix",
    "egress_log_cursors.last_key",
    "trip_plan_invites.token_hash",
  ],
  "geometry: a snapshot exists to give a dev real map data (see the end of snapshot-scrub.sql)":
    [
      "media.metadata",
      "routes.points",
      "routes.anchors",
      "topo_jobs.footprint",
      "topo_export_jobs.bbox",
    ],
  "settings and results the worker or a client writes, never typed text": [
    "users.vector_style",
    "topo_jobs.layer_options",
    "topo_jobs.vector_style_snapshot",
    "topo_jobs.auto_export",
    "topo_jobs.sharpen",
    "topo_jobs.pipeline_metrics",
    "topo_jobs.error_message",
    "topo_export_jobs.layers",
    "topo_export_jobs.vector_style_snapshot",
    "topo_export_jobs.error_message",
    "topo_templates.config",
    "topo_templates.auto_export",
  ],
  "public text, not a user's": [
    "places.ropewiki_snapshot",
    "announcements.title",
    "announcements.body",
  ],
};

/** `@@map("x")` for a model, else its snake-cased name. */
function tableOf(model: string): string {
  const body = modelBody(model);
  return /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model.toLowerCase();
}

function modelBody(model: string): string {
  const match = new RegExp(`^model ${model} \\{$([\\s\\S]*?)^\\}$`, "m").exec(
    schema,
  );
  if (!match) throw new Error(`model ${model} not found in schema.prisma`);
  return match[1];
}

/** The fields a `@relation(fields: [...])` in the model stores a foreign key in. */
function foreignKeys(model: string): Set<string> {
  const keys = new Set<string>();
  for (const [, list] of modelBody(model).matchAll(/fields:\s*\[([^\]]*)\]/g))
    for (const key of list.split(",")) keys.add(key.trim());
  return keys;
}

/** Text and Json columns, as `table.column`. `id` and foreign keys are
 *  excluded: they carry no free text and repointing them is not a scrub. A
 *  column that is only named like an id (`gaugeId`) is not a foreign key. */
function textColumns(model: string): string[] {
  const columns: string[] = [];
  const fks = foreignKeys(model);
  for (const line of modelBody(model).split("\n")) {
    const field = /^\s{2}(\w+)\s+(String|Json)(\[\])?(\?)?(?:\s|$)/.exec(line);
    if (!field) continue;
    const [, name] = field;
    if (name === "id" || fks.has(name)) continue;
    columns.push(
      `${tableOf(model)}.${/@map\("([^"]+)"\)/.exec(line)?.[1] ?? columnName(name)}`,
    );
  }
  return columns;
}

const MODELS = [...schema.matchAll(/^model (\w+) \{$/gm)].map(([, m]) => m);

/**
 * The DB column for a field with no `@map`.
 *
 * Prisma does NOT snake_case automatically — an unmapped `altNames` is a column
 * literally called "altNames". Verbatim is the rule: snake_casing here would
 * hide mismatches with a scrub that named a nonexistent column.
 */
const columnName = (field: string) => field;

/** The script without its `--` comments, so a statement mentioned in one counts for nothing. */
const scrubStatements = scrubSql.replace(/--.*$/gm, "");

/** (table, column) pairs the scrub assigns to. */
function scrubbedColumns(): Set<string> {
  const pairs = new Set<string>();
  // UPDATE <table> SET a = ..., b = ...  — up to the next statement.
  const statements = scrubStatements.matchAll(
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
    const mapped = new Set(
      [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map(([, t]) => t),
    );
    for (const table of tables) {
      expect(mapped.has(table), `scrub targets unknown table "${table}"`).toBe(
        true,
      );
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
      expect(
        columns!.has(column),
        `scrub targets unknown column "${pair}"`,
      ).toBe(true);
    }
  });

  // Mutation that turns it red: add `body String` to any model (or a new model)
  // without listing the column in SCRUBBED or SAFE.
  it("declares every text or Json column of every model", () => {
    const declared = new Set([...SCRUBBED, ...Object.values(SAFE).flat()]);
    const columns = MODELS.flatMap(textColumns);
    expect(
      columns.length,
      "the schema scan found almost no columns: its regexes stopped matching",
    ).toBeGreaterThan(100);
    expect(MODELS.length).toBeGreaterThan(30);
    const undecided = columns.filter((pair) => !declared.has(pair));
    expect(
      undecided,
      "these columns are in no decision. If a user can type into it, add a " +
        "statement to scripts/snapshot-scrub.sql and a plant to " +
        "scripts/snapshot-scrub-canary.sql, and list it in SCRUBBED in this file; " +
        "otherwise list it in SAFE with the reason it leaks nothing",
    ).toEqual([]);
    const stale = [...declared].filter((pair) => !columns.includes(pair));
    expect(
      stale,
      "SCRUBBED or SAFE names a column that is not in schema.prisma (or is a foreign key): remove it",
    ).toEqual([]);
  });

  it("declares no column both scrubbed and safe", () => {
    const safe = Object.values(SAFE).flat();
    expect(safe.filter((pair) => SCRUBBED.includes(pair))).toEqual([]);
    expect(new Set(safe).size, "a SAFE column is listed twice").toBe(
      safe.length,
    );
    expect(new Set(SCRUBBED).size, "a SCRUBBED column is listed twice").toBe(
      SCRUBBED.length,
    );
  });

  // Mutation that turns it red: delete any one assignment from the SQL (an
  // UPDATE of email, username, media, routes, gauge_id, topo_jobs.name ...).
  it("assigns every scrubbed column in the SQL, and nothing else", () => {
    const assigned = scrubbedColumns();
    expect(assigned.size).toBeGreaterThan(30);
    expect(
      SCRUBBED.filter((pair) => !assigned.has(pair)),
      "these columns are declared SCRUBBED but scripts/snapshot-scrub.sql no longer assigns them",
    ).toEqual([]);
    expect(
      [...assigned].filter((pair) => !SCRUBBED.includes(pair)),
      "scripts/snapshot-scrub.sql assigns a column that is not in SCRUBBED: add it there",
    ).toEqual([]);
  });

  // The CI canary plants one marker per scrubbed column and fails when it
  // survives the scrub (scripts/snapshot-scrub-canary.sh). Mutation that turns
  // it red: delete a plant from the canary SQL, or add a column to SCRUBBED.
  it("plants a canary marker in every scrubbed column", () => {
    const planted = readFileSync(
      join(REPO_ROOT, "scripts", "snapshot-scrub-canary.sql"),
      "utf8",
    );
    const markers = new Set(
      [...planted.matchAll(/CANARY-([a-z_]+)-([A-Za-z_]+)/g)].map(
        ([, table, column]) => `${table}.${column}`,
      ),
    );
    expect(
      [...markers].sort(),
      "scripts/snapshot-scrub-canary.sql must plant a CANARY-<table>-<column> marker in exactly the columns of SCRUBBED",
    ).toEqual([...SCRUBBED].sort());
  });

  // Mutation that turns it red: drop the WHERE from the place_types UPDATE, so
  // the shared system types (Canyon, Waypoint ...) lose their names too.
  it("renames only user-owned place types", () => {
    expect(scrubStatements).toMatch(
      /UPDATE place_types\s+SET[^;]*WHERE owner_id IS NOT NULL;/,
    );
  });

  // `users.ui_preferences` is Json, so the column walk cannot see inside it.
  // Until a contract migration drops them, a user's row may still carry the
  // custom-field LABELS the defs table was backfilled from
  // (20260905100000_custom_field_defs_table). Mutation: drop one key.
  it("removes the legacy label arrays from ui_preferences", () => {
    const removed =
      /UPDATE users\s+SET[^;]*ui_preferences\s*=\s*ui_preferences((?: - '\w+')+)/.exec(
        scrubStatements,
      );
    expect(removed, "the ui_preferences scrub").not.toBeNull();
    for (const key of [
      "tripLogCustomFields",
      "canyonCustomFields",
      "placeCustomFields",
    ])
      expect(removed![1]).toContain(`'${key}'`);
  });

  // Logjam's suggested trip types survive the scrub — they are not user text,
  // and dev analytics key on `canyoning`. The SQL spells that list itself, so it
  // has to agree with the one declaration or a new suggestion gets pseudonymised.
  it("keeps exactly TRIP_TYPE_SUGGESTIONS when scrubbing trip types", () => {
    const kept = /lower\(tag\) = ANY \(ARRAY\[([^\]]*)\]\)/.exec(scrubSql);
    expect(kept, "scrub_trip_types' kept-vocabulary array").not.toBeNull();
    const words = [...kept![1].matchAll(/'([^']*)'/g)].map(([, word]) => word);
    expect(words).toEqual([...TRIP_TYPE_SUGGESTIONS]);
  });

  // notifications.payload is Json, so the column walk above cannot see inside
  // it. Any payload key a writer stamps whose name says text must be removed
  // by the scrub. Mutation: drop 'planName' from the UPDATE and this fails.
  it("removes every text key a notification payload is written with", () => {
    const writers = ["lib", "routes"].flatMap((dir) =>
      readdirSync(join(REPO_ROOT, "api", "src", dir))
        .filter((f) => f.endsWith(".ts") && !/test/.test(f))
        .map((f) => join(REPO_ROOT, "api", "src", dir, f)),
    );
    const textKeys = new Set<string>();
    for (const file of writers) {
      for (const [, body] of readFileSync(file, "utf8").matchAll(
        /\bpayload:\s*\{([^}]*)\}/g,
      )) {
        for (const [, key] of body.matchAll(/(?:^|[\s{,])(\w+)\s*:/g)) {
          if (/name|title|body|text|label/i.test(key)) textKeys.add(key);
        }
      }
    }
    // Read-time display only, never stored (notifications.ts resolves them
    // from live rows), or not user text: maintainer copy, account usernames.
    for (const exempt of [
      "title",
      "body",
      "placeName",
      "sentByUsername",
      "sharedByUsername",
    ])
      textKeys.delete(exempt);
    expect(textKeys.size).toBeGreaterThan(0);
    const removed =
      /UPDATE notifications\s+SET payload = payload((?: - '\w+')+);/.exec(
        scrubSql,
      );
    expect(removed, "the notifications payload scrub").not.toBeNull();
    for (const key of textKeys) expect(removed![1]).toContain(`'${key}'`);
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
