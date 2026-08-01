// Outbox enqueue path (stage8-sync.md §8.2): local mutations write the
// mirror optimistically (effective row materialized into columns, §8.5) and
// append a push op to the FIFO outbox via the shared coalescing planner.
// Flushing is flush.ts's job; a debounced sync request fires after every
// enqueue so field edits batch into one cycle.
import * as Crypto from "expo-crypto";
import {
  isUuidV4,
  planOutboxEnqueue,
  validateCanyonPayload,
  type OutboxEntry,
  type SyncPushEntity,
  type SyncPushOp,
} from "@logjam/shared";

import { getSyncDb, notifyMirrorChanged } from "./syncDb";
import { scheduleMutationSync } from "./mediaSyncBridge";

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
    attempts: row.attempts,
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

/**
 * Local changes not yet accepted by the server — queued, inflight or blocked.
 * Drives the "N waiting to sync" indicator; `blocked` rows are counted because
 * from the user's point of view they are still unsent work.
 */
export async function countPendingOps(): Promise<number> {
  const db = await getSyncDb();
  // Parked ops are NOT pending: countSyncIssues already counts blocked +
  // deadRemote, so including 'blocked' here made one stuck op render as
  // "1 change needs you / 1 other change is still queued" — the same op,
  // twice, on the line the user reads to decide whether their work is safe.
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE state IN ('queued', 'inflight')",
  );
  return row?.n ?? 0;
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

const WAYPOINT_UPDATE_COLUMNS: Record<string, ColumnSpec> = {
  name: "name",
  latitude: "latitude",
  longitude: "longitude",
  elevation: "elevation",
  symbol: "symbol",
  notes: "notes",
  canyonId: "canyon_id",
};

export async function updateWaypointLocal(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await enqueueUpdate("waypoint", "waypoints", id, fields, WAYPOINT_UPDATE_COLUMNS);
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

// ── canyon / trip update surface ─────────────────────────────────────────────
//
// Field-scoped updates over the generic enqueueUpdate path (§8.2 coalescing,
// §8.5 optimistic materialization). Only own rows are pushable: a shared
// canyon's update would 404 server-side and park deadRemote, so callers gate
// the edit UI on syncRole === "owner". These maps list ONLY scalar columns —
// array/object fields (altNames, attributes, types, customFields, canyon
// links) aren't materialized here because enqueueUpdate binds values raw.

const CANYON_UPDATE_COLUMNS: Record<string, ColumnSpec> = {
  name: "name",
  notes: "notes",
  quality: "quality",
  hours: "hours",
  numAbseils: "num_abseils",
  longestAbseil: "longest_abseil",
  vGrade: "v_grade",
  aGrade: "a_grade",
  commitment: "commitment",
  latitude: "latitude",
  longitude: "longitude",
  altNames: {
    column: "alt_names_json",
    encode: (value) => JSON.stringify(value ?? []),
    decode: (raw) => JSON.parse((raw as string | null) ?? "[]"),
  },
};

export async function updateCanyonLocal(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await enqueueUpdate("canyon", "canyons", id, fields, CANYON_UPDATE_COLUMNS);
}

/** The fields a canyon can be created with offline. Coordinates are required:
 * a canyon without a position isn't a canyon, and the server rejects it. */
export type CanyonDraftFields = {
  name: string;
  latitude: number;
  longitude: number;
  altNames?: string[];
  numAbseils?: number | null;
  longestAbseil?: number | null;
  vGrade?: number | null;
  aGrade?: number | null;
  commitment?: number | null;
  quality?: number | null;
  hours?: number | null;
  notes?: string | null;
};

/**
 * Add a canyon offline: optimistic mirror row + a canyon.create op. Mirrors
 * createTripLocal — every field is locally dirty until the create flushes, and
 * the server row replaces the provisional timestamps.
 *
 * Validated with the same predicate the API applies (`validateCanyonPayload`),
 * so a bad value fails here with a message rather than parking a deadRemote op
 * on the next flush.
 */
export async function createCanyonLocal(draft: CanyonDraftFields): Promise<string> {
  const id = mintUuid();
  const now = new Date().toISOString();
  const altNames = draft.altNames ?? [];
  const fields: Record<string, unknown> = {
    name: draft.name,
    latitude: draft.latitude,
    longitude: draft.longitude,
    altNames,
    ...optionalNumbers(draft),
    ...(draft.notes != null && { notes: draft.notes }),
  };

  const invalid = validateCanyonPayload(fields, { requireCoords: true });
  if (invalid) throw new Error(invalid);

  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO canyons
         (id, sync_role, name, latitude, longitude, alt_names_json, num_abseils,
          longest_abseil, v_grade, a_grade, commitment, quality, hours, notes,
          attributes_json, forked_from_id, created_at, updated_at, extra_json,
          dirty_fields_json)
       VALUES (?, 'owner', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', NULL, ?, ?, NULL, ?)`,
      id,
      draft.name,
      draft.latitude,
      draft.longitude,
      JSON.stringify(altNames),
      draft.numAbseils ?? null,
      draft.longestAbseil ?? null,
      draft.vGrade ?? null,
      draft.aGrade ?? null,
      draft.commitment ?? null,
      draft.quality ?? null,
      draft.hours ?? null,
      draft.notes ?? null,
      now,
      now,
      JSON.stringify(Object.keys(fields)),
    );
    await appendOp(db, {
      opId: mintUuid(),
      entity: "canyon",
      op: "create",
      id,
      fields,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return id;
}

/** Only the numeric fields the caller actually set — an omitted grade must stay
 * absent from the op rather than being pushed as an explicit null. */
function optionalNumbers(draft: CanyonDraftFields): Record<string, number> {
  const keys = [
    "numAbseils",
    "longestAbseil",
    "vGrade",
    "aGrade",
    "commitment",
    "quality",
    "hours",
  ] as const;
  const out: Record<string, number> = {};
  for (const key of keys) {
    const value = draft[key];
    if (value != null) out[key] = value;
  }
  return out;
}

/**
 * Delete a canyon offline. Owner-only (the caller gates on syncRole): a
 * sharee's delete would 404 server-side and park deadRemote.
 *
 * Trip links to it go with it server-side, so the mirror's trip rows are
 * scrubbed of the link here too — otherwise a trip keeps rendering a title
 * built from a canyon that no longer exists until the next delta pull.
 */
export async function deleteCanyonLocal(id: string): Promise<void> {
  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    const trips = await db.getAllAsync<{ id: string; canyons_json: string }>(
      "SELECT id, canyons_json FROM trip_logs WHERE canyons_json LIKE ?",
      `%${id}%`,
    );
    for (const trip of trips) {
      const links = JSON.parse(trip.canyons_json ?? "[]") as TripCanyonLink[];
      const kept = links.filter((link) => link.id !== id);
      if (kept.length === links.length) continue; // LIKE matched a substring only
      await db.runAsync(
        "UPDATE trip_logs SET canyons_json = ? WHERE id = ?",
        JSON.stringify(kept),
        trip.id,
      );
    }
    await db.runAsync("DELETE FROM canyons WHERE id = ?", id);
    await db.runAsync(
      "DELETE FROM canyon_shares WHERE canyon_id = ?",
      id,
    );
    await appendOp(db, {
      opId: mintUuid(),
      entity: "canyon",
      op: "delete",
      id,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

const TRIP_UPDATE_COLUMNS: Record<string, ColumnSpec> = {
  date: "date",
  displayName: "display_name",
  notes: "notes",
  types: {
    column: "types_json",
    encode: (value) => JSON.stringify(value ?? []),
    decode: (raw) => JSON.parse((raw as string | null) ?? "[]"),
  },
  customFields: {
    column: "custom_fields_json",
    encode: (value) => JSON.stringify(value ?? {}),
    decode: (raw) => JSON.parse((raw as string | null) ?? "{}"),
  },
};

/** A trip's canyon links, ordered — order drives the derived title. */
export type TripCanyonLink = { id: string; name: string };

export type TripDraftFields = {
  /** UTC-midnight ISO instant for a date-only value (CH-001). */
  date: string;
  displayName?: string | null;
  notes?: string | null;
  types?: string[];
  /** Values for the user's own field definitions, keyed by field key. */
  customFields?: Record<string, unknown>;
  /** Ordered; the mirror needs the names, the push op sends ids only. */
  canyons?: TripCanyonLink[];
};

/**
 * The canyon-links column spec. The push op carries ids (`canyonIds`, what the
 * server resolves), but the mirror column stores `{id, name}` because the
 * derived trip title is built from names offline. So the caller has to supply
 * the names it already had on screen — there is no id→name lookup down here,
 * and a blank name would render a blank trip title.
 */
function canyonLinksColumn(links: TripCanyonLink[]): ColumnSpec {
  const nameById = new Map(links.map((link) => [link.id, link.name]));
  return {
    column: "canyons_json",
    encode: (value) =>
      JSON.stringify(
        ((value ?? []) as string[]).map((canyonId) => {
          const name = nameById.get(canyonId);
          if (name == null) {
            throw new Error("Trip canyon link is missing its name for the mirror row");
          }
          return { id: canyonId, name };
        }),
      ),
    decode: (raw) =>
      (JSON.parse((raw as string | null) ?? "[]") as TripCanyonLink[]).map(
        (link) => link.id,
      ),
  };
}

/**
 * Field-scoped trip update. `canyons` is translated into the `canyonIds` op
 * field; every other key passes through as-is.
 */
export async function updateTripLocal(
  id: string,
  fields: Omit<Partial<TripDraftFields>, "canyons"> & { canyons?: TripCanyonLink[] },
): Promise<void> {
  const { canyons, ...scalar } = fields;
  const columns: Record<string, ColumnSpec> = { ...TRIP_UPDATE_COLUMNS };
  const opFields: Record<string, unknown> = { ...scalar };
  if (canyons !== undefined) {
    columns.canyonIds = canyonLinksColumn(canyons);
    opFields.canyonIds = canyons.map((link) => link.id);
  }
  await enqueueUpdate("tripLog", "trip_logs", id, opFields, columns);
}

/**
 * Log a trip offline: optimistic mirror row + a tripLog.create op. Mirrors
 * createWaypointLocal — every field is locally dirty until the create flushes,
 * and the server row replaces the provisional timestamps.
 *
 * `types` is stored exactly as given: the caller applies
 * `enforceCanyoningTag` (shared) so the tag list it displayed is the one the
 * server will store.
 */
export async function createTripLocal(draft: TripDraftFields): Promise<string> {
  const id = mintUuid();
  const now = new Date().toISOString();
  const canyons = draft.canyons ?? [];
  const types = draft.types ?? [];
  const customFields = draft.customFields ?? {};
  const fields: Record<string, unknown> = {
    date: draft.date,
    types,
    canyonIds: canyons.map((link) => link.id),
    ...(Object.keys(customFields).length > 0 && { customFields }),
    ...(draft.displayName != null && { displayName: draft.displayName }),
    ...(draft.notes != null && { notes: draft.notes }),
  };

  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO trip_logs
         (id, date, display_name, types_json, notes, custom_fields_json,
          canyons_json, created_at, updated_at, extra_json, dirty_fields_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      id,
      draft.date,
      draft.displayName ?? null,
      JSON.stringify(types),
      draft.notes ?? null,
      JSON.stringify(customFields),
      JSON.stringify(canyons),
      now,
      now,
      JSON.stringify(Object.keys(fields)),
    );
    await appendOp(db, {
      opId: mintUuid(),
      entity: "tripLog",
      op: "create",
      id,
      fields,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return id;
}

export async function deleteTripLocal(id: string): Promise<void> {
  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM trip_logs WHERE id = ?", id);
    await appendOp(db, {
      opId: mintUuid(),
      entity: "tripLog",
      op: "delete",
      id,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

// ── notification markRead surface ────────────────────────────────────────────
//
// Notifications aren't in the delta protocol (§4.7 refetch-and-cache), so a
// markRead has no mirror row to touch — the inbox cache is patched separately
// (patchCachedRead). This routes the read through the SAME outbox as every
// other mutation so it survives offline: the op flushes on the next cycle, and
// the server treats markRead as a monotonic no-op (idempotent, §6). The shared
// planner dedups a markRead against an already-queued one for the same id.

export async function enqueueNotificationRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getSyncDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await appendOp(db, {
        opId: mintUuid(),
        entity: "notification",
        op: "markRead",
        id,
      });
    }
  });
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
 * How an op field maps onto its mirror column. A bare string is the scalar
 * case (column name, value bound raw). Array/object fields need the pair:
 * SQLite can't bind them, and the conflict base snapshot has to be read back
 * in the op's own shape (§6 compares base against the server's field values,
 * not against our JSON encoding).
 */
type ColumnSpec =
  | string
  | {
      column: string;
      encode: (value: unknown) => string | number | null;
      decode: (raw: unknown) => unknown;
    };

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
  columnByField: Record<string, ColumnSpec>,
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
    const specFor = (field: string): ColumnSpec => {
      const spec = columnByField[field];
      if (!spec) throw new Error(`Unknown ${entity} field: ${field}`);
      return spec;
    };

    const baseSnapshot: Record<string, unknown> = {};
    for (const field of Object.keys(fields)) {
      if (!dirtyNow.has(field)) {
        const spec = specFor(field);
        baseSnapshot[field] =
          typeof spec === "string"
            ? current[spec] ?? null
            : spec.decode(current[spec.column]);
      }
      dirtyNow.add(field);
    }

    // Materialize the effective values.
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(fields)) {
      const spec = specFor(field);
      assignments.push(`${typeof spec === "string" ? spec : spec.column} = ?`);
      values.push(typeof spec === "string" ? value ?? null : spec.encode(value));
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

// ── discard-an-update revert ────────────────────────────────────────────────

const UPDATE_TARGETS: Partial<
  Record<SyncPushEntity, { table: string; columns: Record<string, ColumnSpec> }>
> = {
  canyon: { table: "canyons", columns: CANYON_UPDATE_COLUMNS },
  tripLog: { table: "trip_logs", columns: TRIP_UPDATE_COLUMNS },
  waypoint: { table: "waypoints", columns: WAYPOINT_UPDATE_COLUMNS },
};

/**
 * Put the mirror back the way it was before a DISCARDED update.
 *
 * `enqueueUpdate` materializes an edit into the mirror columns immediately, so
 * discarding the op has to undo that write — otherwise the rejected value sits
 * on screen indefinitely (the canyon keeps the name the server refused), and
 * the field stays in `dirty_fields_json`, which then makes the NEXT edit skip
 * its base snapshot and shelve spurious conflicts. Only the create case used
 * to be cleaned up.
 *
 * `remainingDirty` are the fields a still-pending op owns: those are left
 * alone, because a newer edit — not the discarded one — is what the column
 * currently holds.
 */
export async function revertDiscardedUpdate(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  entity: SyncPushEntity,
  id: string,
  baseFields: Record<string, unknown>,
  remainingDirty: Set<string>,
): Promise<void> {
  const target = UPDATE_TARGETS[entity];
  if (!target) return;
  const current = await db.getFirstAsync<{ dirty_fields_json: string | null }>(
    `SELECT dirty_fields_json FROM ${target.table} WHERE id = ?`,
    id,
  );
  if (!current) return;

  const assignments: string[] = [];
  const values: unknown[] = [];
  const reverted: string[] = [];
  for (const [field, value] of Object.entries(baseFields)) {
    if (remainingDirty.has(field)) continue;
    const spec =
      field === "canyonIds" && entity === "tripLog"
        ? await canyonLinksColumnFromMirror(db, value)
        : target.columns[field];
    if (!spec) continue;
    assignments.push(`${typeof spec === "string" ? spec : spec.column} = ?`);
    values.push(typeof spec === "string" ? value ?? null : spec.encode(value));
    reverted.push(field);
  }
  if (reverted.length === 0) return;

  const dirty = new Set(JSON.parse(current.dirty_fields_json ?? "[]") as string[]);
  for (const field of reverted) dirty.delete(field);
  assignments.push("dirty_fields_json = ?");
  values.push(dirty.size ? JSON.stringify([...dirty]) : null);
  await db.runAsync(
    `UPDATE ${target.table} SET ${assignments.join(", ")} WHERE id = ?`,
    ...(values as (string | number | null)[]),
    id,
  );
}

/** `canyonLinksColumn` needs id→name, and a revert has only the ids the base
 * snapshot decoded to. The names are in the mirror's own canyons table. */
async function canyonLinksColumnFromMirror(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  baseValue: unknown,
): Promise<ColumnSpec> {
  const ids = Array.isArray(baseValue) ? (baseValue as string[]) : [];
  const links: TripCanyonLink[] = [];
  for (const canyonId of ids) {
    const canyon = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM canyons WHERE id = ?",
      canyonId,
    );
    // A canyon the mirror no longer holds can't be named, so it can't be put
    // back — drop the link rather than write a blank trip title.
    if (canyon) links.push({ id: canyonId, name: canyon.name });
  }
  return canyonLinksColumn(links);
}
