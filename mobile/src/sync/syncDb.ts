// Stage 8 on-device mirror (stage8-sync.md §9): logjam.db holds the
// server-authoritative mirror, the outbox, and sync bookkeeping. Separate
// from logjam-offline.db (map artifacts / imports / tracks — local-only by
// design, never in the sync protocol).
//
// PRIVACY: mirror rows carry canyon names and coordinates. App-private
// storage (expo-sqlite default dir, allowBackup=false), surfaced behind the
// Stage 4 app lock; contents must never reach logs, telemetry, or crash
// reports. Wiped on explicit sign-out (outbox included, after the "N
// unsynced changes" confirmation — see wipeAllSyncData).
import * as SQLite from "expo-sqlite";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// Mirror mutations notify listeners so screens re-read without polling —
// same pattern as offline/registryDb.ts.
type Listener = () => void;
const listeners = new Set<Listener>();
export function onMirrorChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyMirrorChanged(): void {
  for (const listener of listeners) listener();
}

export async function getSyncDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("logjam.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        -- sync bookkeeping: cursor, epoch, userId, lastSyncAt, protocol
        CREATE TABLE IF NOT EXISTS sync_state (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- FIFO outbox (§8.2). base_fields_json is an addition over the spec
        -- DDL: the enqueue path snapshots the server-confirmed value of each
        -- newly-dirtied field so the flush engine can drop self-conflict
        -- receipts (§6 over-report contract) without reconstructing history.
        CREATE TABLE IF NOT EXISTS outbox (
          seq              INTEGER PRIMARY KEY AUTOINCREMENT,
          op_id            TEXT NOT NULL UNIQUE,
          entity           TEXT NOT NULL,
          op               TEXT NOT NULL,
          entity_id        TEXT NOT NULL,
          base_updated_at  TEXT,
          fields_json      TEXT,
          base_fields_json TEXT,
          state            TEXT NOT NULL DEFAULT 'queued',
          media_phase      TEXT,
          error_json       TEXT,
          attempts         INTEGER NOT NULL DEFAULT 0,
          created_at       TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS outbox_state ON outbox(state, seq);

        CREATE TABLE IF NOT EXISTS conflict_shelf (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          entity      TEXT NOT NULL,
          entity_id   TEXT NOT NULL,
          field       TEXT NOT NULL,
          shelved_json TEXT,
          server_json  TEXT,
          at          TEXT NOT NULL
        );

        -- Mirrors: typed columns for list/filter/map-critical fields;
        -- extra_json preserves server fields this app version doesn't know
        -- (additive protocol §10.3 — display-only, never round-tripped).
        -- Columns hold the EFFECTIVE row (server state + local dirty fields
        -- materialized, §8.5) so reads are plain SQL; dirty_fields_json
        -- lists the locally-dirty field names for rebase-on-pull.
        CREATE TABLE IF NOT EXISTS canyons (
          id TEXT PRIMARY KEY,
          sync_role TEXT NOT NULL,
          name TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          alt_names_json TEXT,
          num_abseils INTEGER,
          longest_abseil REAL,
          v_grade INTEGER,
          a_grade INTEGER,
          commitment INTEGER,
          quality REAL,
          hours REAL,
          notes TEXT,
          attributes_json TEXT,
          forked_from_id TEXT,
          created_at TEXT,
          updated_at TEXT,
          extra_json TEXT,
          dirty_fields_json TEXT
        );
        CREATE TABLE IF NOT EXISTS trip_logs (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          display_name TEXT,
          types_json TEXT,
          notes TEXT,
          custom_fields_json TEXT,
          canyons_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT,
          updated_at TEXT,
          extra_json TEXT,
          dirty_fields_json TEXT
        );
        -- owner_id + sync_role mirror the routes table: a waypoint linked to a
        -- canyon shared with this user arrives here read-only.
        CREATE TABLE IF NOT EXISTS waypoints (
          id TEXT PRIMARY KEY,
          owner_id TEXT,
          canyon_ids_json TEXT,
          tags_json TEXT,
          sync_role TEXT,
          name TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          elevation REAL,
          symbol TEXT,
          notes TEXT,
          created_at TEXT,
          updated_at TEXT,
          extra_json TEXT,
          dirty_fields_json TEXT
        );
        -- Drawn/imported routes. points_json holds the whole geometry
        -- ([[lon, lat], ...]) because the server stores it on the row too --
        -- there is no blob to cache, so a route works offline the moment the
        -- delta lands.
        CREATE TABLE IF NOT EXISTS routes (
          id TEXT PRIMARY KEY,
          owner_id TEXT,
          canyon_id TEXT,
          name TEXT NOT NULL,
          color TEXT,
          points_json TEXT NOT NULL,
          anchors_json TEXT,
          sync_role TEXT,
          created_at TEXT,
          updated_at TEXT,
          extra_json TEXT,
          dirty_fields_json TEXT
        );
        CREATE INDEX IF NOT EXISTS routes_canyon ON routes(canyon_id);

        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY,
          linked_type TEXT NOT NULL,
          linked_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          filename TEXT,
          file_size_bytes TEXT,
          color TEXT,
          created_at TEXT,
          extra_json TEXT,
          sync_state TEXT NOT NULL DEFAULT 'synced',
          local_display_path TEXT,
          local_thumb_path TEXT
        );
        CREATE INDEX IF NOT EXISTS media_linked ON media(linked_type, linked_id);
        CREATE TABLE IF NOT EXISTS canyon_shares (
          id TEXT PRIMARY KEY,
          canyon_id TEXT NOT NULL,
          direction TEXT NOT NULL,
          counterpart_user_id TEXT,
          counterpart_username TEXT,
          created_at TEXT,
          extra_json TEXT
        );
        CREATE TABLE IF NOT EXISTS friendships (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          direction TEXT NOT NULL,
          counterpart_user_id TEXT,
          counterpart_username TEXT,
          created_at TEXT,
          updated_at TEXT,
          extra_json TEXT
        );
        -- last GET /notifications verbatim (§4.7: refetch-and-cache, not
        -- cursor-synced)
        CREATE TABLE IF NOT EXISTS notifications_cache (
          fetched_at   TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
      await addMissingColumns(db);
      return db;
    })();
  }
  return dbPromise;
}

/**
 * Columns added to a table that already exists on installed devices.
 *
 * `CREATE TABLE IF NOT EXISTS` above only ever builds the schema for a FRESH
 * install — it silently does nothing when the table is already there, so an
 * app that has synced before never gains a new column and every insert naming
 * it fails with "no such column". That is not theoretical: it broke saving a
 * route on the first device that ran the anchors change.
 *
 * SQLite has no ADD COLUMN IF NOT EXISTS, so each add is attempted and a
 * duplicate-column error is the success case. Keep entries here forever —
 * removing one strands anyone who skipped that version.
 */
const ADDED_COLUMNS: { table: string; column: string; type: string }[] = [
  // Which vertices of a route the user placed, vs snapped filler.
  { table: "routes", column: "anchors_json", type: "TEXT" },
  // Waypoints gained tags and many-to-many canyon links, and can now arrive
  // through a canyon share (owner_id + sync_role, as routes already do). The
  // old single canyon_id column stays where it is: dropping a column means
  // rebuilding the table in SQLite, and a stale column costs nothing.
  { table: "waypoints", column: "owner_id", type: "TEXT" },
  { table: "waypoints", column: "canyon_ids_json", type: "TEXT" },
  { table: "waypoints", column: "tags_json", type: "TEXT" },
  { table: "waypoints", column: "sync_role", type: "TEXT" },
];

async function addMissingColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const { table, column, type } of ADDED_COLUMNS) {
    try {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch {
      // Already present — the expected outcome on every launch after the
      // first. Nothing to log: this is not an error condition.
    }
  }
}

// ── sync_state key/value helpers ─────────────────────────────────────────────

export async function getSyncStateValue(key: string): Promise<string | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

export async function setSyncStateValue(key: string, value: string): Promise<void> {
  const db = await getSyncDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)",
    key,
    value,
  );
}

const MIRROR_TABLES = [
  "canyons",
  "trip_logs",
  "waypoints",
  "media",
  "canyon_shares",
  "friendships",
] as const;

/**
 * resetRequired (§4.3): wipe the MIRROR and the cursor — never the outbox.
 * Unsynced local work survives a server-forced resync; pending ops rebase
 * onto the freshly-pulled rows.
 */
export async function wipeMirror(): Promise<void> {
  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    for (const table of MIRROR_TABLES) {
      await db.runAsync(`DELETE FROM ${table}`);
    }
    await db.runAsync("DELETE FROM sync_state WHERE key = 'cursor'");
  });
  notifyMirrorChanged();
}

/**
 * Explicit sign-out / account switch (§9): everything goes, outbox included.
 * The caller owns the blocking "you have N unsynced changes" confirmation
 * BEFORE calling this — this function does not ask.
 */
export async function wipeAllSyncData(): Promise<void> {
  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    for (const table of MIRROR_TABLES) {
      await db.runAsync(`DELETE FROM ${table}`);
    }
    await db.runAsync("DELETE FROM outbox");
    await db.runAsync("DELETE FROM conflict_shelf");
    await db.runAsync("DELETE FROM notifications_cache");
    await db.runAsync("DELETE FROM sync_state");
  });
  notifyMirrorChanged();
}

/** Count of unflushed local changes — drives the sign-out confirmation. */
export async function countUnsyncedChanges(): Promise<number> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox",
  );
  return row?.n ?? 0;
}

export type LocalEntityCounts = {
  canyons: number;
  trips: number;
  media: number;
};

/**
 * What this device holds, by kind — for the guest→account link confirmation.
 *
 * Deliberately counts MIRROR rows rather than outbox ops: the user is being
 * asked about their canyons and photos, not about a queue depth, and after a
 * partial flush the two numbers diverge. Media is called out separately
 * because it is the part that takes hours, not seconds, to upload.
 */
export async function countLocalEntities(): Promise<LocalEntityCounts> {
  const db = await getSyncDb();
  const [canyons, trips, media] = await Promise.all([
    db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM canyons"),
    db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM trip_logs"),
    db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM media"),
  ]);
  return {
    canyons: canyons?.n ?? 0,
    trips: trips?.n ?? 0,
    media: media?.n ?? 0,
  };
}
