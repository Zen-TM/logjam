// The ONE declaration of what logjam.db holds (stage8-sync.md §9).
//
// Everything that needs to know the shape of the sync database derives from
// this file: the CREATE statements, both wipes, and the schema-version reset.
// That is the point — `routes` was added to the schema and never joined
// MIRROR_TABLES, so sign-out left the previous user's route geometry (their
// coordinates through canyons) on the phone, and a forced resync left stale
// rows behind. A list maintained beside the DDL drifts from it; a list the DDL
// is BUILT from cannot.
//
// PRIVACY: mirror rows carry canyon names and coordinates. The wipe derived
// here is the privacy boundary between two users of one phone
// (mobile/CLAUDE.md) — a new table must be unable to escape it.

/**
 * `mirror` — server-authoritative rows this device caches. Rebuildable from a
 * delta pull, so both wipes and the schema reset may drop them freely.
 * `local` — data that exists ONLY here: unsent writes (outbox), values the
 * user has not resolved (conflict_shelf), and sync bookkeeping. Never dropped
 * by a mirror reset; only an explicit sign-out clears them.
 */
export type TableKind = "mirror" | "local";

export type TableSchema = {
  name: string;
  kind: TableKind;
  /** Column name → its DDL type + constraints, in declaration order. */
  columns: Record<string, string>;
  /** Extra CREATE INDEX statements (name and body only). */
  indexes?: { name: string; on: string }[];
};

export const SYNC_TABLES: readonly TableSchema[] = [
  {
    name: "sync_state",
    kind: "local",
    columns: { key: "TEXT PRIMARY KEY", value: "TEXT NOT NULL" },
  },
  {
    // FIFO outbox (§8.2). base_fields_json is an addition over the spec DDL:
    // the enqueue path snapshots the server-confirmed value of each newly
    // dirtied field so the flush engine can drop self-conflict receipts (§6
    // over-report contract) without reconstructing history.
    name: "outbox",
    kind: "local",
    columns: {
      seq: "INTEGER PRIMARY KEY AUTOINCREMENT",
      op_id: "TEXT NOT NULL UNIQUE",
      entity: "TEXT NOT NULL",
      op: "TEXT NOT NULL",
      entity_id: "TEXT NOT NULL",
      base_updated_at: "TEXT",
      fields_json: "TEXT",
      base_fields_json: "TEXT",
      state: "TEXT NOT NULL DEFAULT 'queued'",
      media_phase: "TEXT",
      error_json: "TEXT",
      attempts: "INTEGER NOT NULL DEFAULT 0",
      created_at: "TEXT NOT NULL",
    },
    indexes: [
      { name: "outbox_state", on: "outbox(state, seq)" },
      // The enqueue and confirm paths read one row's ops, not the whole queue.
      { name: "outbox_entity", on: "outbox(entity, entity_id)" },
    ],
  },
  {
    name: "conflict_shelf",
    kind: "local",
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      entity: "TEXT NOT NULL",
      entity_id: "TEXT NOT NULL",
      field: "TEXT NOT NULL",
      shelved_json: "TEXT",
      server_json: "TEXT",
      at: "TEXT NOT NULL",
      // The name of the row this value belongs to, captured WHEN IT IS SHELVED
      // rather than read from the mirror at display time. The mirror row can be
      // deleted afterwards, and then the only thing left saying which canyon a
      // rescued paragraph of notes came from is gone with it — every such entry
      // read "Your notes on a canyon". Added after the table shipped, so it
      // reaches existing installs through `ensureLocalColumns` (syncDb.ts), not
      // the mirror's drop-and-rebuild lever.
      entity_name: "TEXT",
    },
  },
  // Mirrors: typed columns for list/filter/map-critical fields; extra_json
  // preserves server fields this app version doesn't know (additive protocol
  // §10.3 — display-only, never round-tripped). Columns hold the EFFECTIVE row
  // (server state + local dirty fields materialized, §8.5) so reads are plain
  // SQL; dirty_fields_json lists the locally-dirty field names for
  // rebase-on-pull.
  {
    name: "canyons",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      sync_role: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      latitude: "REAL NOT NULL",
      longitude: "REAL NOT NULL",
      alt_names_json: "TEXT",
      num_abseils: "INTEGER",
      longest_abseil: "REAL",
      v_grade: "INTEGER",
      a_grade: "INTEGER",
      commitment: "INTEGER",
      quality: "REAL",
      hours: "REAL",
      notes: "TEXT",
      attributes_json: "TEXT",
      forked_from_id: "TEXT",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      dirty_fields_json: "TEXT",
    },
  },
  {
    name: "trip_logs",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      date: "TEXT NOT NULL",
      display_name: "TEXT",
      types_json: "TEXT",
      notes: "TEXT",
      custom_fields_json: "TEXT",
      canyons_json: "TEXT NOT NULL DEFAULT '[]'",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      dirty_fields_json: "TEXT",
    },
  },
  {
    // owner_id + sync_role mirror the routes table: a waypoint linked to a
    // canyon shared with this user arrives here read-only. Canyon links are
    // many-to-many and live in canyon_ids_json — there is no canyon_id column.
    name: "waypoints",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      owner_id: "TEXT",
      canyon_ids_json: "TEXT",
      tags_json: "TEXT",
      sync_role: "TEXT",
      // Owner rows only: how many people it is directly shared with, for
      // the Saved row's shared-out badge. NULL on a row shared WITH this
      // user (the server withholds it — owner-private cardinality) and on
      // one written by a local create, which has no server answer yet.
      shared_count: "INTEGER",
      name: "TEXT NOT NULL",
      latitude: "REAL NOT NULL",
      longitude: "REAL NOT NULL",
      elevation: "REAL",
      symbol: "TEXT",
      notes: "TEXT",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      dirty_fields_json: "TEXT",
    },
  },
  {
    // Drawn/imported routes. points_json holds the whole geometry
    // ([[lon, lat], ...]) because the server stores it on the row too — there
    // is no blob to cache, so a route works offline the moment the delta lands.
    name: "routes",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      owner_id: "TEXT",
      canyon_id: "TEXT",
      name: "TEXT NOT NULL",
      color: "TEXT",
      points_json: "TEXT NOT NULL",
      anchors_json: "TEXT",
      sync_role: "TEXT",
      shared_count: "INTEGER",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      dirty_fields_json: "TEXT",
    },
    indexes: [{ name: "routes_canyon", on: "routes(canyon_id)" }],
  },
  {
    // Every file this account owns. `linked_id` is NULL on a standalone file
    // (`linked_type = 'none'`): an import the user brought in or a track they
    // recorded, which belongs to no canyon. That is the row that makes those
    // two things sync at all.
    //
    // `metadata_json` carries the stats (bbox, distance, counts) so the Saved
    // list can render a file this device has never downloaded — the blob is
    // fetched on demand, the row always arrives. `local_display_path` NULL
    // therefore means "not on this phone", not "broken".
    name: "media",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      linked_type: "TEXT NOT NULL",
      linked_id: "TEXT",
      media_type: "TEXT NOT NULL",
      filename: "TEXT",
      display_name: "TEXT",
      file_size_bytes: "TEXT",
      color: "TEXT",
      origin: "TEXT",
      metadata_json: "TEXT",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      sync_state: "TEXT NOT NULL DEFAULT 'synced'",
      local_display_path: "TEXT",
      local_thumb_path: "TEXT",
    },
    indexes: [
      { name: "media_linked", on: "media(linked_type, linked_id)" },
      // The Saved tab's two standalone lists, which read by origin rather than
      // by parent.
      { name: "media_origin", on: "media(origin)" },
    ],
  },
  {
    name: "canyon_shares",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      canyon_id: "TEXT NOT NULL",
      direction: "TEXT NOT NULL",
      counterpart_user_id: "TEXT",
      counterpart_username: "TEXT",
      created_at: "TEXT",
      extra_json: "TEXT",
    },
  },
  {
    name: "friendships",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      status: "TEXT NOT NULL",
      direction: "TEXT NOT NULL",
      counterpart_user_id: "TEXT",
      counterpart_username: "TEXT",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
    },
  },
  {
    // Last GET /notifications verbatim (§4.7: refetch-and-cache, not
    // cursor-synced). Server-derived, so it is a mirror table: it goes in both
    // wipes and is rebuilt by a refetch.
    name: "notifications_cache",
    kind: "mirror",
    columns: { fetched_at: "TEXT NOT NULL", payload_json: "TEXT NOT NULL" },
  },
];

export const MIRROR_TABLES: readonly TableSchema[] = SYNC_TABLES.filter(
  (table) => table.kind === "mirror",
);

export function tableSchema(name: string): TableSchema | undefined {
  return SYNC_TABLES.find((table) => table.name === name);
}

/** The full DDL, idempotent — run on every open. */
export function createSchemaSql(): string {
  return SYNC_TABLES.map(createTableSql).join("\n");
}

function createTableSql(table: TableSchema): string {
  const columns = Object.entries(table.columns)
    .map(([name, decl]) => `  ${name} ${decl}`)
    .join(",\n");
  const indexes = (table.indexes ?? []).map(
    (index) => `\nCREATE INDEX IF NOT EXISTS ${index.name} ON ${index.on};`,
  );
  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n${columns}\n);${indexes.join("")}`;
}
