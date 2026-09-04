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

import {
  MIRROR_TABLES,
  SYNC_TABLES,
  createSchemaSql,
} from "./mirrorSchema";

/**
 * Bump whenever the mirror's shape changes. On a mismatch the mirror tables
 * are DROPPED and rebuilt empty, and the cursor is cleared so the next pull
 * refetches everything from zero.
 *
 * This replaces an ALTER TABLE ladder that only ever ADDED columns, which is
 * how a tombstone cascade came to write `waypoints.canyon_id` — a column that
 * existed on upgraded installs and on no fresh one, so the delta transaction
 * rolled back forever and sync died silently on every new phone. The mirror is
 * a rebuildable cache of the server; recreating it is always available and
 * always correct, and it cannot half-apply.
 *
 * The `local` tables (outbox, conflict_shelf, sync_state) are NOT rebuildable
 * — the outbox holds writes the server has never seen — so they survive the
 * reset untouched. A change to THEIR shape needs its own migration, and this
 * lever won't do it.
 */
export const MIRROR_SCHEMA_VERSION = 4;

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
      await db.execAsync(`PRAGMA journal_mode = WAL;\n${createSchemaSql()}`);
      await ensureLocalColumns(db);
      await applySchemaVersion(db);
      return db;
    })();
  }
  return dbPromise;
}

/**
 * The `local` tables' migration, and the only one they get.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, and
 * the version lever above deliberately refuses to touch these three — dropping
 * the outbox would destroy writes the server has never seen. So a column added
 * to a local table after it shipped reaches an existing install only here:
 * every declared column missing from `PRAGMA table_info` is added.
 *
 * Derived from SYNC_TABLES rather than a hand-kept ladder, so a new local
 * column cannot join the declaration and miss the migration (the parallel-list
 * rule in CLAUDE.md — `mirrorSchema.test.ts` is the check). ADD COLUMN is the
 * only shape supported: SQLite cannot drop or retype in place, and a local
 * table that needs either needs a written migration, not this.
 */
async function ensureLocalColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const table of SYNC_TABLES) {
    if (table.kind !== "local") continue;
    const existing = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(${table.name})`,
    );
    const present = new Set(existing.map((column) => column.name));
    for (const [name, decl] of Object.entries(table.columns)) {
      if (present.has(name)) continue;
      await db.execAsync(`ALTER TABLE ${table.name} ADD COLUMN ${name} ${decl}`);
    }
  }
}

/**
 * Drop-and-rebuild the mirror when the declared schema moved. A fresh install
 * takes the same path — the tables it drops are empty, and one code path is
 * worth more than the microsecond.
 */
async function applySchemaVersion(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = ?",
    "schemaVersion",
  );
  if (row?.value === String(MIRROR_SCHEMA_VERSION)) return;

  await db.withTransactionAsync(async () => {
    for (const table of MIRROR_TABLES) {
      await db.runAsync(`DROP TABLE IF EXISTS ${table.name}`);
    }
    // The cursor acknowledges rows that no longer exist here; the next pull
    // must start from zero. lastSyncAt goes with it — it would claim the
    // mirror is current when it is empty.
    await db.runAsync(
      "DELETE FROM sync_state WHERE key IN ('cursor', 'lastSyncAt')",
    );
  });
  await db.execAsync(createSchemaSql());
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)",
    "schemaVersion",
    String(MIRROR_SCHEMA_VERSION),
  );
}

// ── single-writer discipline ────────────────────────────────────────────────

/**
 * EVERY multi-statement write to logjam.db goes through here.
 *
 * expo-sqlite's `withTransactionAsync` is a bare BEGIN / task / COMMIT on the
 * one shared connection, and its own doc comment says the order of execution
 * is not guaranteed. Two overlapping callers — a delta page applying while the
 * user drops a waypoint — produce a nested-BEGIN error whose ROLLBACK aborts
 * the OTHER transaction, or a COMMIT that lands mid-page and leaves the cursor
 * write outside any transaction. Both silently lose data.
 *
 * A promise-chain mutex rather than `withExclusiveTransactionAsync`: the
 * exclusive variant takes its own connection, which turns the same collision
 * into a `database is locked` throw that every UI call site would have to
 * handle. Serialising makes the second writer WAIT, which is what the callers
 * already assume.
 *
 * ponytail: single-statement writes issued outside any transaction are still
 * atomic on their own, but one issued while another task's transaction is open
 * is adopted by it and rolled back with it. Every such write is a replay-safe
 * state flip today. Closing it fully means routing every write through this
 * lock, which needs an async-context-aware reentrancy check RN doesn't have.
 */
let writeChain: Promise<unknown> = Promise.resolve();

export async function withSyncTransaction<T>(
  db: SQLite.SQLiteDatabase,
  task: () => Promise<T>,
): Promise<T> {
  const previous = writeChain;
  let release!: () => void;
  writeChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  // A failed predecessor must not poison the queue — it owns its own error.
  await previous.catch(() => {});
  try {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task();
    });
    return result;
  } finally {
    release();
  }
}

// ── sync_state key/value helpers ─────────────────────────────────────────────

/** sync_state key recording a delta page this client could not fully apply —
 * a whole page that threw, or individual rows dropped as unreadable. Survives
 * a restart and is counted as a sync issue. Written by both `syncEngine` and
 * `deltaPull`, which is why it lives here rather than in either of them. */
export const APPLY_FAILED_KEY = "applyFailedAt";

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

export async function clearSyncStateValue(key: string): Promise<void> {
  const db = await getSyncDb();
  await db.runAsync("DELETE FROM sync_state WHERE key = ?", key);
}

/**
 * resetRequired (§4.3): wipe the MIRROR and the cursor — never the outbox.
 * Unsynced local work survives a server-forced resync; pending ops rebase
 * onto the freshly-pulled rows.
 *
 * Two things the plain `DELETE FROM every mirror table` got wrong:
 *
 *  - `lastSyncAt` stayed, so `hasMirrorSynced()` kept saying yes over an empty
 *    mirror. If the post-reset pull then failed — the network dropping mid-
 *    drain is exactly the company a forced reset keeps — every screen rendered
 *    an empty list with no first-sync error state and a stale "last synced"
 *    claim. `applySchemaVersion` documents the same rule for the same event.
 *  - a locally-created row exists ONLY as its optimistic mirror row until its
 *    create op flushes, so wiping it made the user's unsynced canyons, trips
 *    and waypoints vanish from every screen — while "Changes still waiting to
 *    upload are kept" was the sentence they had just agreed to, and while the
 *    ops themselves did survive. Offline, nothing brings them back. Rows named
 *    by a create op still in the outbox are therefore kept, in any op state:
 *    a parked create is unsent work too, and `discardParkedOp` is the one path
 *    that deliberately removes its row.
 */
export async function wipeMirror(): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    for (const table of MIRROR_TABLES) {
      // Entity ids are UUIDv4, so one global id set needs no entity→table map.
      // `notifications_cache` is keyless (and server-derived) — it just goes.
      const keep =
        "id" in table.columns
          ? " WHERE id NOT IN (SELECT entity_id FROM outbox WHERE op = 'create')"
          : "";
      await db.runAsync(`DELETE FROM ${table.name}${keep}`);
    }
    await db.runAsync(
      "DELETE FROM sync_state WHERE key IN ('cursor', 'applyFailedAt', 'lastSyncAt')",
    );
  });
  notifyMirrorChanged();
}

/**
 * Explicit sign-out / account switch (§9): everything goes, outbox included.
 * The caller owns the blocking "you have N unsynced changes" confirmation
 * BEFORE calling this — this function does not ask.
 *
 * Every table in the schema, derived — a table added to `mirrorSchema.ts` is
 * in the account-transition wipe the moment it exists. `schemaVersion` is
 * re-seeded because it lives in sync_state and describes the FILE, not the
 * account.
 */
export async function wipeAllSyncData(): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    for (const table of SYNC_TABLES) {
      await db.runAsync(`DELETE FROM ${table.name}`);
    }
    await db.runAsync(
      "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)",
      "schemaVersion",
      String(MIRROR_SCHEMA_VERSION),
    );
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
