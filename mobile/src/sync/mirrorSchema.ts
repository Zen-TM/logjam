// The ONE declaration of what logjam.db holds (stage8-sync.md §9).
//
// Everything that needs to know the shape of the sync database derives from
// this file: the CREATE statements, both wipes, and the schema-version reset.
// That is the point — `routes` was added to the schema and never joined
// MIRROR_TABLES, so sign-out left the previous user's route geometry (their
// coordinates through places) on the phone, and a forced resync left stale
// rows behind. A list maintained beside the DDL drifts from it; a list the DDL
// is BUILT from cannot.
//
// PRIVACY: mirror rows carry place names and coordinates. The wipe derived
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
      // deleted afterwards, and then the only thing left saying which place a
      // rescued paragraph of notes came from is gone with it — every such entry
      // read "Your notes on a place". Added after the table shipped, so it
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
    name: "places",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      sync_role: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      latitude: "REAL NOT NULL",
      longitude: "REAL NOT NULL",
      alt_names_json: "TEXT",
      place_type_id: "TEXT NOT NULL DEFAULT ''",
      notes: "TEXT",
      // Folded in from `waypoints` in phase 1c, along with the rows. `symbol`
      // did NOT come with them: the icon is the place TYPE's now.
      elevation: "REAL",
      // The seven grade columns and `attributes_json` collapsed into ONE JSON
      // column, keyed by definition key. That is the whole shape change of the
      // rework on this side: a campsite and a canyon are the same row now, and
      // the difference is which keys are in here.
      field_values_json: "TEXT",
      // The definitions that label the values above, for a place of a type the
      // VIEWER does not own — a place shared with them. Absent otherwise,
      // because they hold the definitions themselves.
      field_defs_snapshot_json: "TEXT",
      // OWNER-PRIVATE. Never arrives on a shared row (the server strips it), so
      // a value here always belongs to this account.
      foreign_fields_json: "TEXT",
      forked_from_id: "TEXT",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      dirty_fields_json: "TEXT",
    },
  },
  {
    // Place TYPES: the user's own plus the SYSTEM ones (owner_id null), which
    // are global rows shared by every account. A client must not read a null
    // owner as "mine" — it means "everyone's, and not editable".
    name: "place_types",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      owner_id: "TEXT",
      name: "TEXT NOT NULL",
      icon_key: "TEXT NOT NULL",
      color: "TEXT NOT NULL",
      position: "INTEGER NOT NULL DEFAULT 0",
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
      places_json: "TEXT NOT NULL DEFAULT '[]'",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      dirty_fields_json: "TEXT",
    },
  },
  {
    // Custom field DEFINITIONS. A mirror table like any other, which is the
    // whole point of moving them off the user record: defining, renaming and
    // deleting a field is now the same offline-capable write path as creating
    // a place, for a guest and for a linked user alike.
    //
    // `owner_id` IS NULL for a SYSTEM definition — the seven canyon grades and
    // their kin are global rows belonging to no account, exactly like a system
    // place type. It used to have no column at all, on the premise that "every
    // definition the server sends is the caller's own"; the delta has sent both
    // kinds since the types landed, so the phone could not tell them apart and
    // offered Rename and Delete on a built-in field. Deleting one stripped its
    // value off every place in the account while the server no-opped the def
    // delete — the definition came back on the next pull and the values did
    // not. There is no `sync_role`: a definition is never SHARED with anyone.
    //
    // PRIVACY: `label` is user-authored text about their canyoning. It is in
    // the mirror, so it is inside the sign-out wipe derived from SYNC_TABLES —
    // which is the reason a definition must never be stored anywhere else.
    name: "custom_field_defs",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      // NULL = a system definition. See the header above.
      owner_id: "TEXT",
      // "tripLog" | "place".
      entity: "TEXT NOT NULL",
      // The slug the stored values are keyed by. Stable across a rename.
      key: "TEXT NOT NULL",
      label: "TEXT NOT NULL",
      type: "TEXT NOT NULL",
      min: "REAL",
      max: "REAL",
      position: "INTEGER NOT NULL DEFAULT 0",
      // WHERE the definition appears. Without these two the phone holds every
      // definition and cannot tell which form any of them belongs on — it
      // would put a canyon's grades on a campsite. `appliesToAllTypes` is a
      // flag rather than a row per type so a type created tomorrow inherits it.
      applies_to_all_types: "INTEGER NOT NULL DEFAULT 0",
      place_type_ids_json: "TEXT",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      dirty_fields_json: "TEXT",
    },
    indexes: [
      {
        name: "custom_field_defs_entity",
        on: "custom_field_defs(entity, position)",
      },
    ],
  },
  {
    // Links between two places, symmetric and stored once (a_place_id is the
    // lexicographically lower id). OWNER-PRIVATE: a link grants no visibility,
    // so every row here belongs to this account and there is no sync_role or
    // shared_count to carry.
    //
    // A row per link rather than a `place_ids_json` column on `places`,
    // matching the server: the link has its own id, so create and delete are
    // ops in their own right and two phones linking from opposite ends collide
    // on one row instead of clobbering each other's whole list.
    name: "place_links",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      owner_id: "TEXT",
      a_place_id: "TEXT NOT NULL",
      b_place_id: "TEXT NOT NULL",
      created_at: "TEXT",
      updated_at: "TEXT",
      extra_json: "TEXT",
      dirty_fields_json: "TEXT",
    },
    indexes: [
      { name: "place_links_a", on: "place_links(a_place_id)" },
      { name: "place_links_b", on: "place_links(b_place_id)" },
    ],
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
      place_id: "TEXT",
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
    indexes: [{ name: "routes_place", on: "routes(place_id)" }],
  },
  {
    // Every file this account owns. `linked_id` is NULL on a standalone file
    // (`linked_type = 'none'`): an import the user brought in or a track they
    // recorded, which belongs to no place. That is the row that makes those
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
    name: "place_shares",
    kind: "mirror",
    columns: {
      id: "TEXT PRIMARY KEY",
      place_id: "TEXT NOT NULL",
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

/**
 * The DDL for one kind of table, or all of them. Idempotent — run on every open.
 *
 * The SPLIT is load-bearing, not a convenience. `local` tables are created
 * first and never dropped; `mirror` tables must not be created until the
 * version lever has had its chance to drop the stale ones. Creating everything
 * up front looks harmless — every statement is IF NOT EXISTS — but an index on
 * a column added in the same schema bump then runs against the OLD table and
 * fails with "no such column", which aborts the whole exec and so stops the
 * rebuild that would have fixed it. The mirror is then permanently stale and
 * every delta write fails. Found on device (2026-09-04) the first time a new
 * mirror column got an index; `syncDb.test.ts` pins the ordering.
 */
export function createSchemaSql(kind?: TableKind): string {
  return SYNC_TABLES.filter((table) => kind === undefined || table.kind === kind)
    .map(createTableSql)
    .join("\n");
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
