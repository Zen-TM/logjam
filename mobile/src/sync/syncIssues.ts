// Parked-ops + conflict-shelf surface (stage8-sync.md §8.4/§8.5). The
// fail-loudly rule applied to sync: ops the server rejected (blocked) or that
// lost an edit↔delete race (deadRemote), plus shelved conflict values, are
// never silently dropped — they surface here with explicit user actions.
//
// PRIVACY: parked ops and shelf entries carry canyon field values (names,
// coords). Rendered only behind the app lock; never logged.
import type { SyncPushEntity, SyncPushOp } from "@logjam/shared";

import {
  createWaypointLocal,
  type WaypointDraft,
} from "./outbox";
import { getSyncDb, notifyMirrorChanged } from "./syncDb";
import { requestSync } from "./syncEngine";

export type ParkedOp = {
  seq: number;
  entity: SyncPushEntity;
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
    entity: row.entity as SyncPushEntity,
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

/** Badge count for the "Sync issues (N)" row: parked ops + shelf entries. */
export async function countSyncIssues(): Promise<number> {
  const db = await getSyncDb();
  const parked = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE state IN ('blocked', 'deadRemote')",
  );
  const shelf = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM conflict_shelf",
  );
  return (parked?.n ?? 0) + (shelf?.n ?? 0);
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
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<ParkedRow>(
      "SELECT * FROM outbox WHERE seq = ?",
      seq,
    );
    if (!row) return;
    const at = new Date().toISOString();
    if (row.fields_json) {
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
    // A create that never synced leaves an orphan optimistic mirror row.
    if (row.op === "create") {
      await db.runAsync(
        `DELETE FROM ${mirrorTable(row.entity as SyncPushEntity)} WHERE id = ?`,
        row.entity_id,
      );
    }
    await db.runAsync("DELETE FROM outbox WHERE seq = ?", seq);
  });
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
  if (!op || op.entity !== "waypoint" || !op.fields) {
    await discardParkedOp(seq);
    return null;
  }
  const fields = op.fields;
  const draft: WaypointDraft = {
    name: typeof fields.name === "string" ? fields.name : "Recovered waypoint",
    latitude: Number(fields.latitude),
    longitude: Number(fields.longitude),
    elevation: typeof fields.elevation === "number" ? fields.elevation : null,
    symbol: typeof fields.symbol === "string" ? fields.symbol : null,
    notes: typeof fields.notes === "string" ? fields.notes : null,
    canyonId: typeof fields.canyonId === "string" ? fields.canyonId : null,
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

function mirrorTable(entity: SyncPushEntity): string {
  switch (entity) {
    case "canyon":
      return "canyons";
    case "tripLog":
      return "trip_logs";
    case "waypoint":
      return "waypoints";
    case "notification":
      return "notifications_cache"; // no id column; never a create target
  }
}
