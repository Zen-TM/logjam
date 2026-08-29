// Parked-ops + conflict-shelf surface (stage8-sync.md §8.4/§8.5). The
// fail-loudly rule applied to sync: ops the server rejected (blocked) or that
// lost an edit↔delete race (deadRemote), plus shelved conflict values, are
// never silently dropped — they surface here with explicit user actions.
//
// PRIVACY: parked ops and shelf entries carry canyon field values (names,
// coords). Rendered only behind the app lock; never logged.
import * as FileSystem from "expo-file-system/legacy";

import {
  collectDirtyFields,
  type SyncPushEntity,
  type SyncPushOp,
} from "@logjam/shared";

import {
  createWaypointLocal,
  revertDiscardedUpdate,
  type WaypointDraft,
} from "./outbox";
import { loadOutboxEntries } from "./deltaPull";
import {
  outboxMirrorTable,
  shelvesDiscardedFields,
  type OutboxEntity,
} from "./outboxTables";
import {
  getSyncDb,
  getSyncStateValue,
  notifyMirrorChanged,
  wipeMirror,
  withSyncTransaction,
} from "./syncDb";
import { APPLY_FAILED_KEY, requestSync } from "./syncEngine";

export type ParkedOp = {
  seq: number;
  /** The OUTBOX's entity set, which includes `media` — see outboxTables.ts. */
  entity: OutboxEntity;
  op: SyncPushOp["op"];
  entityId: string;
  /** 'blocked' = server rejected (validation/quota); 'deadRemote' = the row
   * was deleted server-side under a pending edit (§6 delete-wins). */
  state: "blocked" | "deadRemote";
  fields: Record<string, unknown> | null;
  error: { code: number; message: string } | null;
  attempts: number;
  createdAt: string;
};

export type ShelfEntry = {
  id: number;
  entity: string;
  entityId: string;
  field: string;
  shelvedValue: unknown;
  serverValue: unknown;
  at: string;
};

const SHELF_TTL_MS = 30 * 24 * 60 * 60 * 1000; // §8.5 auto-purge after 30 days

type ParkedRow = {
  seq: number;
  entity: string;
  op: string;
  entity_id: string;
  state: string;
  fields_json: string | null;
  /** Pre-edit values, for reverting the mirror when an update is discarded. */
  base_fields_json: string | null;
  error_json: string | null;
  attempts: number;
  created_at: string;
};

export async function listParkedOps(): Promise<ParkedOp[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<ParkedRow>(
    `SELECT seq, entity, op, entity_id, state, fields_json, error_json,
            attempts, created_at
     FROM outbox WHERE state IN ('blocked', 'deadRemote') ORDER BY seq ASC`,
  );
  return rows.map((row) => ({
    seq: row.seq,
    entity: row.entity as OutboxEntity,
    op: row.op as SyncPushOp["op"],
    entityId: row.entity_id,
    state: row.state as "blocked" | "deadRemote",
    fields: row.fields_json
      ? (JSON.parse(row.fields_json) as Record<string, unknown>)
      : null,
    error: row.error_json
      ? (JSON.parse(row.error_json) as { code: number; message: string })
      : null,
    attempts: row.attempts,
    createdAt: row.created_at,
  }));
}

export async function listShelfEntries(): Promise<ShelfEntry[]> {
  await purgeExpiredShelf();
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{
    id: number;
    entity: string;
    entity_id: string;
    field: string;
    shelved_json: string | null;
    server_json: string | null;
    at: string;
  }>("SELECT * FROM conflict_shelf ORDER BY at DESC");
  return rows.map((row) => ({
    id: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    field: row.field,
    shelvedValue: row.shelved_json ? JSON.parse(row.shelved_json) : null,
    serverValue: row.server_json ? JSON.parse(row.server_json) : null,
    at: row.at,
  }));
}

/**
 * Badge count for the "Sync issues (N)" row: parked ops + shelf entries + an
 * unapplicable delta page.
 *
 * The last one is why this isn't just two COUNTs: a page this app version
 * can't apply stops the mirror dead, and the only thing that used to say so
 * was a line claiming the account was unreachable and that it would keep
 * retrying. A permanent failure belongs on the screen for permanent failures.
 */
export async function countSyncIssues(): Promise<number> {
  // The §8.5 30-day purge runs here too, not only in listShelfEntries: the
  // badge is polled on every mirror change and the list screen may never be
  // opened, so a conflict resolved by time kept inflating "Sync issues (N)"
  // forever.
  await purgeExpiredShelf();
  const db = await getSyncDb();
  const parked = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE state IN ('blocked', 'deadRemote')",
  );
  const shelf = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM conflict_shelf",
  );
  const applyFailed = await getApplyFailureAt();
  return (parked?.n ?? 0) + (shelf?.n ?? 0) + (applyFailed ? 1 : 0);
}

/** When the last delta page failed to apply locally, or null. */
export async function getApplyFailureAt(): Promise<string | null> {
  return getSyncStateValue(APPLY_FAILED_KEY);
}

/**
 * The recovery for an unapplicable page: throw the mirror away and pull it
 * again from cursor zero. The mirror is a cache of the server, so this costs
 * bandwidth and nothing else — the outbox, which holds work the server has
 * never seen, is deliberately untouched.
 */
export async function resyncFromScratch(): Promise<void> {
  await wipeMirror();
  await requestSync();
}

/** Retry a parked op: requeue it and kick a sync. A blocker that was fixed
 * server-side (quota freed) now succeeds; a still-invalid op re-parks. */
export async function retryParkedOp(seq: number): Promise<void> {
  const db = await getSyncDb();
  await db.runAsync(
    "UPDATE outbox SET state = 'queued', error_json = NULL WHERE seq = ?",
    seq,
  );
  void requestSync();
}

/**
 * Discard a parked op: its field data is moved to the conflict shelf (never
 * silently lost — §8.4) and the op is deleted. The optimistic mirror row it
 * created (a never-synced create) is also removed.
 */
export async function discardParkedOp(seq: number): Promise<void> {
  const db = await getSyncDb();
  // Cache files whose owning row this discard removes; unlinked after the commit.
  const orphanedFiles: string[] = [];
  await withSyncTransaction(db, async () => {
    const row = await db.getFirstAsync<ParkedRow>(
      "SELECT * FROM outbox WHERE seq = ?",
      seq,
    );
    if (!row) return;
    const entity = row.entity as OutboxEntity;
    const at = new Date().toISOString();
    if (row.fields_json && shelvesDiscardedFields(entity)) {
      const fields = JSON.parse(row.fields_json) as Record<string, unknown>;
      for (const [field, value] of Object.entries(fields)) {
        await db.runAsync(
          `INSERT INTO conflict_shelf
             (entity, entity_id, field, shelved_json, server_json, at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
          row.entity,
          row.entity_id,
          field,
          JSON.stringify(value ?? null),
          at,
        );
      }
    }
    // A create that never synced leaves an orphan optimistic mirror row — the
    // pendingUpload tile in a media strip, the ghost canyon in a list. Guard on
    // null: an entity with no id-keyed mirror row must SKIP this, not build
    // `DELETE FROM null` and roll the whole transaction back (which is how
    // "Discard" came to do nothing at all for a media op).
    if (row.op === "create") {
      const table = outboxMirrorTable(entity);
      if (table) {
        // Read the media row's cache paths BEFORE deleting it — dropping the row
        // is what makes the files unreachable, so this is the only chance to
        // learn where they are. (Same shape as the blocked-media path in
        // mediaUpload.ts.)
        if (entity === "media") {
          const media = await db.getFirstAsync<{
            local_display_path: string | null;
            local_thumb_path: string | null;
          }>(
            "SELECT local_display_path, local_thumb_path FROM media WHERE id = ?",
            row.entity_id,
          );
          if (media?.local_display_path) orphanedFiles.push(media.local_display_path);
          if (media?.local_thumb_path) orphanedFiles.push(media.local_thumb_path);
        }
        await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, row.entity_id);
      }
    }

    if (row.op === "update") {
      // Undo the optimistic write this op made. Fields a LATER pending op
      // owns are left alone — that op's value is what the column holds now.
      const base = row.base_fields_json
        ? (JSON.parse(row.base_fields_json) as Record<string, unknown>)
        : {};
      const others = (await loadOutboxEntries()).filter(
        (candidate) => candidate.seq !== seq,
      );
      const remainingDirty = new Set(
        Object.keys(
          collectDirtyFields(others, entity as SyncPushEntity, row.entity_id),
        ),
      );
      await revertDiscardedUpdate(
        db,
        entity as SyncPushEntity,
        row.entity_id,
        base,
        remainingDirty,
      );
    }

    if (row.op === "create") {
      // Discarding a create discards its lineage. The row will never exist
      // server-side, so a queued update or delete still pointing at it is no
      // longer merely deferred (nothing is `blocked` any more) — it flushes,
      // 404s, and parks as a FRESH sync issue. One discard became a cascade.
      await db.runAsync(
        "DELETE FROM outbox WHERE entity_id = ? AND seq != ?",
        row.entity_id,
        seq,
      );
    }
    await db.runAsync("DELETE FROM outbox WHERE seq = ?", seq);
  });
  // File IO is not transactional, so it happens after the commit: a failed
  // unlink must not resurrect the op the user just discarded.
  for (const path of orphanedFiles) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
  notifyMirrorChanged();
}

/**
 * Recreate from a deadRemote op (§6): the server deleted the row, but the
 * user's local edits are preserved — one tap re-creates the entity with a
 * FRESH id from the parked field data, then discards the dead op. Waypoints
 * are the only synced-writable entity with a create surface today; other
 * entities fall back to discard (data shelved).
 */
export async function recreateFromDeadRemote(seq: number): Promise<string | null> {
  const parked = await listParkedOps();
  const op = parked.find((entry) => entry.seq === seq);
  const fields = op?.fields;
  // A parked UPDATE carries only the fields it dirtied, so a rename-only edit
  // (or a create merged from partial fields) has no coordinates at all — and a
  // waypoint with no position is not a waypoint. `Number(undefined)` used to
  // put NaN in a NOT NULL REAL column: the insert threw, the op stayed parked,
  // and Recreate was permanently broken for it until Discard. Fall back to the
  // same discard-and-shelve path every non-waypoint entity takes, so the
  // user's typed values are kept rather than lost.
  if (
    !op ||
    op.entity !== "waypoint" ||
    !fields ||
    typeof fields.latitude !== "number" ||
    typeof fields.longitude !== "number"
  ) {
    await discardParkedOp(seq);
    return null;
  }
  const draft: WaypointDraft = {
    name: typeof fields.name === "string" ? fields.name : "Recovered waypoint",
    latitude: fields.latitude,
    longitude: fields.longitude,
    elevation: typeof fields.elevation === "number" ? fields.elevation : null,
    symbol: typeof fields.symbol === "string" ? fields.symbol : null,
    notes: typeof fields.notes === "string" ? fields.notes : null,
    tags: Array.isArray(fields.tags)
      ? fields.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    // Links are deliberately NOT carried over: the parked op names canyons that
    // may since have been deleted or unshared, and a recreate that silently
    // re-published a coordinate would be the worst possible time to guess. The
    // user re-links from the sheet, seeing what they are linking to.
    canyonIds: [],
  };
  const newId = await createWaypointLocal(draft);
  const db = await getSyncDb();
  await db.runAsync("DELETE FROM outbox WHERE seq = ?", seq);
  notifyMirrorChanged();
  return newId;
}

export async function dismissShelfEntry(id: number): Promise<void> {
  const db = await getSyncDb();
  await db.runAsync("DELETE FROM conflict_shelf WHERE id = ?", id);
}

async function purgeExpiredShelf(): Promise<void> {
  const db = await getSyncDb();
  const cutoff = new Date(Date.now() - SHELF_TTL_MS).toISOString();
  await db.runAsync("DELETE FROM conflict_shelf WHERE at < ?", cutoff);
}

