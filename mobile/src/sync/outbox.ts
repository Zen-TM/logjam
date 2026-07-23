// Outbox enqueue path (stage8-sync.md §8.2): local mutations write the
// mirror optimistically (effective row materialized into columns, §8.5) and
// append a push op to the FIFO outbox via the shared coalescing planner.
// Flushing is flush.ts's job; a debounced sync request fires after every
// enqueue so field edits batch into one cycle.
import * as Crypto from "expo-crypto";
import {
  isUuidV4,
  planOutboxEnqueue,
  type OutboxEntry,
  type SyncPushEntity,
  type SyncPushOp,
} from "@logjam/shared";

import { getSyncDb, notifyMirrorChanged } from "./syncDb";

// The engine registers its debounced-sync scheduler here instead of being
// imported — importing syncEngine from this file closes a require cycle
// (engine → flush → outbox → engine) that Metro warns about.
let mutationSyncScheduler: (() => void) | null = null;
export function setMutationSyncScheduler(scheduler: () => void): void {
  mutationSyncScheduler = scheduler;
}
function scheduleMutationSync(): void {
  mutationSyncScheduler?.();
}

export type OutboxRow = {
  seq: number;
  op_id: string;
  entity: string;
  op: string;
  entity_id: string;
  base_updated_at: string | null;
  fields_json: string | null;
  base_fields_json: string | null;
  state: string;
  error_json: string | null;
  attempts: number;
};

export function rowToEntry(row: OutboxRow): OutboxEntry {
  return {
    seq: row.seq,
    state: row.state as OutboxEntry["state"],
    op: {
      opId: row.op_id,
      entity: row.entity as SyncPushOp["entity"],
      op: row.op as SyncPushOp["op"],
      id: row.entity_id,
      ...(row.base_updated_at != null && { baseUpdatedAt: row.base_updated_at }),
      ...(row.fields_json != null && {
        fields: JSON.parse(row.fields_json) as Record<string, unknown>,
      }),
    },
  };
}

export async function loadOutboxRows(): Promise<OutboxRow[]> {
  const db = await getSyncDb();
  return db.getAllAsync<OutboxRow>("SELECT * FROM outbox ORDER BY seq ASC");
}

function mintUuid(): string {
  const id = Crypto.randomUUID();
  if (!isUuidV4(id)) throw new Error("UUID mint produced a non-v4 id");
  return id;
}

// ── waypoint mutation surface ────────────────────────────────────────────────
//
// Waypoints are the first offline-writable entity (Stage 7's map UI already
// drops/deletes them). Canyon/trip edit forms reuse enqueueOp when they land.

export type WaypointDraft = {
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number | null;
  symbol?: string | null;
  notes?: string | null;
  canyonId?: string | null;
};

export async function createWaypointLocal(draft: WaypointDraft): Promise<string> {
  const id = mintUuid();
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {
    name: draft.name,
    latitude: draft.latitude,
    longitude: draft.longitude,
    ...(draft.elevation != null && { elevation: draft.elevation }),
    ...(draft.symbol != null && { symbol: draft.symbol }),
    ...(draft.notes != null && { notes: draft.notes }),
    ...(draft.canyonId != null && { canyonId: draft.canyonId }),
  };

  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    // Optimistic mirror row: every field is locally dirty until the create
    // flushes (timestamps are provisional; the server row replaces them).
    await db.runAsync(
      `INSERT INTO waypoints
         (id, canyon_id, name, latitude, longitude, elevation, symbol, notes,
          created_at, updated_at, extra_json, dirty_fields_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      id,
      draft.canyonId ?? null,
      draft.name,
      draft.latitude,
      draft.longitude,
      draft.elevation ?? null,
      draft.symbol ?? null,
      draft.notes ?? null,
      now,
      now,
      JSON.stringify(Object.keys(fields)),
    );
    await appendOp(db, {
      opId: mintUuid(),
      entity: "waypoint",
      op: "create",
      id,
      fields,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return id;
}

export async function updateWaypointLocal(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await enqueueUpdate("waypoint", "waypoints", id, fields, {
    name: "name",
    latitude: "latitude",
    longitude: "longitude",
    elevation: "elevation",
    symbol: "symbol",
    notes: "notes",
    canyonId: "canyon_id",
  });
}

export async function deleteWaypointLocal(id: string): Promise<void> {
  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM waypoints WHERE id = ?", id);
    await appendOp(db, {
      opId: mintUuid(),
      entity: "waypoint",
      op: "delete",
      id,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

// ── generic enqueue plumbing ─────────────────────────────────────────────────

type Db = Awaited<ReturnType<typeof getSyncDb>>;

/** Run the shared coalescing planner and apply its plan. Caller owns the
 * transaction and the mirror-side materialization. */
async function appendOp(db: Db, incoming: SyncPushOp): Promise<void> {
  const rows = await db.getAllAsync<OutboxRow>(
    "SELECT * FROM outbox ORDER BY seq ASC",
  );
  const plan = planOutboxEnqueue(rows.map(rowToEntry), incoming);

  for (const seq of plan.dropSeqs) {
    await db.runAsync("DELETE FROM outbox WHERE seq = ?", seq);
  }
  if (plan.mergeIntoSeq !== undefined) {
    // Merge keeps the EARLIEST base snapshot per field (the value the whole
    // coalesced edit is based on); new fields adopt the caller's snapshot.
    const target = rows.find((row) => row.seq === plan.mergeIntoSeq);
    const existingBase = target?.base_fields_json
      ? (JSON.parse(target.base_fields_json) as Record<string, unknown>)
      : {};
    const incomingBase = pendingBaseSnapshot;
    const mergedBase = { ...incomingBase, ...existingBase };
    await db.runAsync(
      "UPDATE outbox SET fields_json = ?, base_fields_json = ? WHERE seq = ?",
      JSON.stringify(plan.mergedFields ?? {}),
      Object.keys(mergedBase).length ? JSON.stringify(mergedBase) : null,
      plan.mergeIntoSeq,
    );
  }
  if (plan.append) {
    await db.runAsync(
      `INSERT INTO outbox
         (op_id, entity, op, entity_id, base_updated_at, fields_json,
          base_fields_json, state, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
      plan.append.opId,
      plan.append.entity,
      plan.append.op,
      plan.append.id,
      plan.append.baseUpdatedAt ?? null,
      plan.append.fields ? JSON.stringify(plan.append.fields) : null,
      Object.keys(pendingBaseSnapshot).length
        ? JSON.stringify(pendingBaseSnapshot)
        : null,
      new Date().toISOString(),
    );
  }
  pendingBaseSnapshot = {};
}

// Base-value snapshot for the op being appended/merged (set by
// enqueueUpdate before calling appendOp — same transaction, so module state
// is safe under the engine's serialized writes).
let pendingBaseSnapshot: Record<string, unknown> = {};

/**
 * Generic update enqueue: snapshot base values for newly-dirtied fields
 * (server-confirmed = current column value when the field isn't already
 * dirty), materialize the new values into the mirror columns, extend
 * dirty_fields_json, append/coalesce the op.
 */
async function enqueueUpdate(
  entity: SyncPushEntity,
  table: string,
  id: string,
  fields: Record<string, unknown>,
  columnByField: Record<string, string>,
): Promise<void> {
  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    const current = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = ?`,
      id,
    );
    if (!current) throw new Error(`${entity} row missing for local update`);

    const dirtyNow = new Set(
      JSON.parse((current.dirty_fields_json as string) ?? "[]") as string[],
    );
    const baseSnapshot: Record<string, unknown> = {};
    for (const field of Object.keys(fields)) {
      if (!dirtyNow.has(field)) {
        baseSnapshot[field] = current[columnByField[field]] ?? null;
      }
      dirtyNow.add(field);
    }

    // Materialize the effective values.
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(fields)) {
      const column = columnByField[field];
      if (!column) throw new Error(`Unknown ${entity} field: ${field}`);
      assignments.push(`${column} = ?`);
      values.push(value ?? null);
    }
    assignments.push("dirty_fields_json = ?");
    values.push(JSON.stringify([...dirtyNow]));
    await db.runAsync(
      `UPDATE ${table} SET ${assignments.join(", ")} WHERE id = ?`,
      ...(values as (string | number | null)[]),
      id,
    );

    pendingBaseSnapshot = baseSnapshot;
    await appendOp(db, {
      opId: mintUuid(),
      entity,
      op: "update",
      id,
      // Conflict DETECTION base (§6): the server updatedAt this edit saw.
      ...(typeof current.updated_at === "string" && {
        baseUpdatedAt: current.updated_at,
      }),
      fields,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

// ── Stage 7 → Stage 8 waypoint migration ─────────────────────────────────────
//
// Stage 7 stored dropped waypoints in a local-only table (logjam-offline.db
// `waypoint`). Stage 8 makes waypoints a synced entity; promote any legacy
// rows into the mirror + outbox once, then clear the legacy table.

export async function migrateLegacyWaypoints(): Promise<void> {
  // Lazy import: keeps offline/ and sync/ decoupled at module load.
  const { getOfflineDb } = await import("../offline/registryDb");
  const legacyDb = await getOfflineDb();
  const rows = await legacyDb.getAllAsync<{
    id: string;
    name: string;
    lon: number;
    lat: number;
  }>("SELECT id, name, lon, lat FROM waypoint");
  if (rows.length === 0) return;
  for (const row of rows) {
    await createWaypointLocal({
      name: row.name,
      latitude: row.lat,
      longitude: row.lon,
    });
    await legacyDb.runAsync("DELETE FROM waypoint WHERE id = ?", row.id);
  }
}
