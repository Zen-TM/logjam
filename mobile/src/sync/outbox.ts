// Outbox enqueue path (stage8-sync.md §8.2): local mutations write the
// mirror optimistically (effective row materialized into columns, §8.5) and
// append a push op to the FIFO outbox via the shared coalescing planner.
// Flushing is flush.ts's job; a debounced sync request fires after every
// enqueue so field edits batch into one cycle.
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import {
  isUuidV4,
  canonicalLinkPair,
  SYSTEM_PLACE_TYPE_IDS,
  pickNextTrackColor,
  planOutboxEnqueue,
  setFieldValues,
  SYSTEM_FIELD_DEFS,
  validatePlacePayload,
  type CustomFieldEntity,
  type OutboxEntry,
  type TripLogCustomFieldDef,
  type SyncPushEntity,
  type SyncPushOp,
} from "@logjam/shared";

import type { TripPlaceLink } from "./placeLinks";
import { isOutboxEntity, outboxMirrorTable } from "./outboxTables";
import { cascadePlaceDelete } from "./mirrorStore";
import { getSyncDb, notifyMirrorChanged, withSyncTransaction } from "./syncDb";
import { scheduleMutationSync } from "./mediaSyncBridge";

/** A trip's place links, ordered — order drives the derived title. */
export type { TripPlaceLink };

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
  // `retrying` IS pending: the app will send it again by itself, so it belongs
  // on "3 changes waiting to send" and not on the screen for things only the
  // user can resolve.
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE state IN ('queued', 'inflight', 'retrying')",
  );
  return row?.n ?? 0;
}

/**
 * Ids the ACCOUNT does not hold yet: every entity with a create op still in the
 * outbox, in any unsent state.
 *
 * Drives the "backed up" mark on a Saved row, so the question it answers is
 * narrow and literal — is there a copy of this on the server? A pending UPDATE
 * does not belong here: the row IS in the account, just a revision behind, and
 * marking it unsaved would tell a user their place is at risk because they
 * renamed it on a train. A create is the only op whose absence means the thing
 * does not exist there at all.
 *
 * A parked op counts as pending for exactly the same reason `countSyncIssues`
 * surfaces one: an op the user has to resolve has not been sent, and a mark
 * that says otherwise is the one lie this indicator must not tell.
 */
export async function pendingCreateIds(): Promise<Set<string>> {
  const db = await getSyncDb();
  // No state filter: a successful op is DELETED from the outbox, so a create
  // row still being here is the whole condition.
  const rows = await db.getAllAsync<{ entity_id: string }>(
    "SELECT entity_id FROM outbox WHERE op = 'create'",
  );
  return new Set(rows.map((row) => row.entity_id));
}

export async function loadOutboxRows(): Promise<OutboxRow[]> {
  const db = await getSyncDb();
  return db.getAllAsync<OutboxRow>("SELECT * FROM outbox ORDER BY seq ASC");
}

/**
 * One row's ops. The rebase after a confirmed push needs the pending ops for
 * that entity and nothing else — it used to re-read and re-parse the ENTIRE
 * outbox once per applied op, i.e. fifty full-table scans per push batch, with
 * route geometry in the rows. Indexed by `outbox(entity, entity_id)`.
 */
export async function loadOutboxRowsFor(
  entity: string,
  entityId: string,
): Promise<OutboxRow[]> {
  const db = await getSyncDb();
  return db.getAllAsync<OutboxRow>(
    "SELECT * FROM outbox WHERE entity = ? AND entity_id = ? ORDER BY seq ASC",
    entity,
    entityId,
  );
}

function mintUuid(): string {
  const id = Crypto.randomUUID();
  if (!isUuidV4(id)) throw new Error("UUID mint produced a non-v4 id");
  return id;
}

// ── place link mutation surface ──────────────────────────────────────────────
//
// A link has no fields, so its vocabulary is `create` and `delete` and nothing
// else — there is no update op and nothing for the §6 conflict machinery to
// merge. Two phones linking the same pair from opposite ends both send a
// create; the server canonicalises the pair, the unique index collides, and the
// second one comes back alreadyApplied with the row that won.
//
// The pair is canonicalised HERE as well, so the optimistic mirror row matches
// the row the server will return rather than flipping its ends on the next
// pull.

export async function createPlaceLinkLocal(
  firstPlaceId: string,
  secondPlaceId: string,
): Promise<string> {
  if (firstPlaceId === secondPlaceId) {
    throw new Error("A place cannot be linked to itself");
  }
  const { aPlaceId, bPlaceId } = canonicalLinkPair(firstPlaceId, secondPlaceId);
  const id = mintUuid();
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = { aPlaceId, bPlaceId };

  const db = await getSyncDb();
  // Already linked (from either end) is not an error: the goal state is
  // reached, and enqueueing a second create would only earn an alreadyApplied.
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM place_links WHERE a_place_id = ? AND b_place_id = ?",
    aPlaceId,
    bPlaceId,
  );
  if (existing) return existing.id;

  await withSyncTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO place_links
         (id, owner_id, a_place_id, b_place_id, created_at, updated_at,
          extra_json, dirty_fields_json)
       VALUES (?, NULL, ?, ?, ?, ?, NULL, ?)`,
      id,
      aPlaceId,
      bPlaceId,
      now,
      now,
      JSON.stringify(Object.keys(fields)),
    );
    await appendOp(db, {
      opId: mintUuid(),
      entity: "placeLink",
      op: "create",
      id,
      fields,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return id;
}

export async function deletePlaceLinkLocal(id: string): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync("DELETE FROM place_links WHERE id = ?", id);
    await appendOp(db, {
      opId: mintUuid(),
      entity: "placeLink",
      op: "delete",
      id,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

// A string list: the mirror stores it as JSON text while the OUTBOX carries the
// real array, exactly as route geometry does, so a §6 conflict compares arrays
// against the server's arrays rather than against our JSON encoding.
const stringListColumn = (column: string): ColumnSpec => ({
  column,
  encode: (value) => JSON.stringify(value ?? []),
  decode: (raw) => {
    if (typeof raw !== "string") return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
});

// ── routes ───────────────────────────────────────────────────────────────────
//
// Geometry rides in `fields.points` like any other value — no blob, no
// presign, so a route drawn with no signal is just an ordinary queued create.

export type RouteDraft = {
  name: string;
  points: [number, number][];
  /** Indices into `points` the user placed; the rest is snapped filler. */
  anchors?: number[] | null;
  placeId?: string | null;
  /** From TRACK_COLORS. Omitted means "pick one for me". */
  color?: string;
};

export async function createRouteLocal(draft: RouteDraft): Promise<string> {
  const id = mintUuid();
  const now = new Date().toISOString();
  const db = await getSyncDb();
  // The colour is chosen HERE, not left to the server. Leaving it null meant
  // every freshly drawn route rendered in the same fallback accent, and then
  // changed to a random palette colour when the create op came back — so the
  // route you had just finished appeared to recolour itself the moment you
  // drew the next one. The server honours a palette colour it is given.
  let color = draft.color;
  if (!color) {
    const existing = await db.getAllAsync<{ color: string | null }>(
      "SELECT color FROM routes WHERE color IS NOT NULL",
    );
    color = pickNextTrackColor(existing.map((r) => r.color));
  }
  const fields: Record<string, unknown> = {
    name: draft.name,
    points: draft.points,
    color,
    ...(draft.anchors != null && { anchors: draft.anchors }),
    ...(draft.placeId != null && { placeId: draft.placeId }),
  };

  await withSyncTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO routes
         (id, owner_id, place_id, name, color, points_json, anchors_json,
          sync_role, created_at, updated_at, extra_json, dirty_fields_json)
       VALUES (?, NULL, ?, ?, ?, ?, ?, 'owner', ?, ?, NULL, ?)`,
      id,
      draft.placeId ?? null,
      draft.name,
      color,
      JSON.stringify(draft.points),
      draft.anchors == null ? null : JSON.stringify(draft.anchors),
      now,
      now,
      JSON.stringify(Object.keys(fields)),
    );
    await appendOp(db, {
      opId: mintUuid(),
      entity: "route",
      op: "create",
      id,
      fields,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return id;
}

const ROUTE_UPDATE_COLUMNS: Record<string, ColumnSpec> = {
  name: "name",
  placeId: "place_id",
  color: "color",
  // The mirror stores geometry as JSON text, so the value is encoded into the
  // column while the OUTBOX carries the real array — and decode reads the base
  // snapshot back in the op's shape, so a §6 conflict compares arrays against
  // the server's arrays rather than against our JSON encoding.
  points: {
    column: "points_json",
    encode: (value) => JSON.stringify(value),
    decode: (raw) => {
      if (typeof raw !== "string") return [];
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    },
  },
  // Anchors travel with the geometry they index — a points edit that left
  // stale anchors behind would mark the wrong vertices as the user's.
  anchors: {
    column: "anchors_json",
    encode: (value) => (value == null ? null : JSON.stringify(value)),
    decode: (raw) => {
      if (typeof raw !== "string") return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
  },
};

export async function updateRouteLocal(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await enqueueUpdate("route", "routes", id, fields, ROUTE_UPDATE_COLUMNS);
}

export async function deleteRouteLocal(id: string): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync("DELETE FROM routes WHERE id = ?", id);
    await appendOp(db, {
      opId: mintUuid(),
      entity: "route",
      op: "delete",
      id,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

// ── custom field definitions ─────────────────────────────────────────────────
//
// The whole reason definitions moved off the user record: they are now written
// exactly like a place or a route — materialized into the mirror immediately,
// queued for the server, flushed whenever there is a connection. A guest's
// writes are the same writes, simply never flushed (mobile/CLAUDE.md), so the
// account-state branch that used to live in `fieldDefsStore` is gone.
//
// `key` and `entity` are create-only. Every stored value is keyed by `key`, so
// changing it would orphan them all; `entity` decides which rows those values
// live on. A rename moves `label` (see `renameCustomFieldLabel`), never `key`.

const CUSTOM_FIELD_DEF_UPDATE_COLUMNS: Record<string, ColumnSpec> = {
  label: "label",
  type: "type",
  min: "min",
  max: "max",
  position: "position",
  // WHERE the field appears. Editable, unlike `key` and `entity`: rescoping a
  // field to another type moves the form it shows up on and leaves every
  // stored value attached, which is the whole reason scoping is a property of
  // the definition rather than a second definition.
  placeTypeIds: stringListColumn("place_type_ids_json"),
  tripTypes: stringListColumn("trip_types_json"),
  appliesToAllTypes: {
    column: "applies_to_all_types",
    encode: (value) => (value ? 1 : 0),
    decode: (raw) => raw === 1,
  },
};

export type CustomFieldDefDraft = {
  entity: CustomFieldEntity;
  def: TripLogCustomFieldDef;
  /** WHERE it appears. A definition created with none of these appears on no
   *  form — which is visible and fixable, unlike one that appears on every
   *  form. `placeTypeIds` scopes a place field, `tripTypes` a trip field. */
  placeTypeIds?: string[];
  tripTypes?: string[];
  appliesToAllTypes?: boolean;
};

export async function createCustomFieldDefLocal(
  draft: CustomFieldDefDraft,
): Promise<string> {
  const id = mintUuid();
  const now = new Date().toISOString();
  const db = await getSyncDb();
  const { entity, def } = draft;

  // Append to the end of this entity's list, matching what the server's
  // `nextPosition` would have chosen.
  const last = await db.getFirstAsync<{ position: number }>(
    "SELECT position FROM custom_field_defs WHERE entity = ? ORDER BY position DESC LIMIT 1",
    entity,
  );
  const position = last ? last.position + 1 : 0;

  const fields: Record<string, unknown> = {
    entity,
    key: def.key,
    label: def.label,
    type: def.type,
    position,
    // EACH BOUND INDEPENDENTLY. Requiring both dropped every one-sided bound —
    // which is what every "how many" field has, because there is no honest
    // ceiling for one — and the field reached the server unbounded. Same bug
    // `customFieldDefFromRow` had on the read side (fixed in 1b).
    ...(def.min != null && { min: def.min }),
    ...(def.max != null && { max: def.max }),
    // The scoping travels WITH the create: `CustomFieldDefPlaceType` is not a
    // sync entity of its own, so a def created offline and scoped to two types
    // could not express that scoping any other way — it would arrive unscoped
    // and apply nowhere.
    ...(draft.placeTypeIds?.length ? { placeTypeIds: draft.placeTypeIds } : {}),
    ...(draft.tripTypes?.length ? { tripTypes: draft.tripTypes } : {}),
    ...(draft.appliesToAllTypes ? { appliesToAllTypes: true } : {}),
  };

  await withSyncTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO custom_field_defs
         (id, entity, key, label, type, min, max, position,
          applies_to_all_types, place_type_ids_json, trip_types_json,
          created_at, updated_at, extra_json, dirty_fields_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      id,
      entity,
      def.key,
      def.label,
      def.type,
      def.min ?? null,
      def.max ?? null,
      position,
      draft.appliesToAllTypes ? 1 : 0,
      JSON.stringify(draft.placeTypeIds ?? []),
      JSON.stringify(draft.tripTypes ?? []),
      now,
      now,
      JSON.stringify(Object.keys(fields)),
    );
    await appendOp(db, {
      opId: mintUuid(),
      entity: "customFieldDef",
      op: "create",
      id,
      fields,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return id;
}

export async function updateCustomFieldDefLocal(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await enqueueUpdate(
    "customFieldDef",
    "custom_field_defs",
    id,
    fields,
    CUSTOM_FIELD_DEF_UPDATE_COLUMNS,
  );
}

/**
 * Delete the definition locally and queue the server's half.
 *
 * Only the DEFINITION is removed here. Stripping the orphaned values off every
 * trip log and place is the server's job (`lib/customFieldDefs.ts`) because
 * this phone can only reach the rows in its own mirror — a value left on a row
 * the phone has not pulled would resurface under a later field with the same
 * slug. Callers that want the values gone from the LOCAL rows too (so the user
 * sees the effect immediately) strip them through the normal update paths
 * first; see `removeFieldDef`.
 */
export async function deleteCustomFieldDefLocal(id: string): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync("DELETE FROM custom_field_defs WHERE id = ?", id);
    await appendOp(db, {
      opId: mintUuid(),
      entity: "customFieldDef",
      op: "delete",
      id,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

// ── place types ─────────────────────────────────────────────────────────────
//
// A place type is created, renamed, recoloured and deleted OFFLINE like
// everything else the user makes: the server's push path already accepted all
// three ops (`PLACE_TYPE_FIELDS` in api/src/routes/sync.ts) and the phone
// simply had no way to send them, so a type could only ever be made on the web.
//
// SYSTEM types are not touched from here. They belong to no account, the server
// refuses a rename and a delete with a 404 (anti-oracle, root CLAUDE.md), and
// the local half of a delete would run first and for real — so the editor
// refuses the verbs rather than offering ones that destroy locally and fail
// remotely.

/** How many positions the built-ins occupy, so a user's first type starts
 *  after them. Derived, never a literal 3. */
const SYSTEM_PLACE_TYPE_COUNT = Object.keys(SYSTEM_PLACE_TYPE_IDS).length;

export async function createPlaceTypeLocal(draft: {
  name: string;
  iconKey: string;
  color: string;
}): Promise<string> {
  const id = mintUuid();
  const now = new Date().toISOString();
  const db = await getSyncDb();

  // Append after the user's own types. System types hold 0-2 and sort first by
  // their null owner, so a user's first type starting at 3 keeps the two orders
  // agreeing without the client having to know how many built-ins there are.
  const last = await db.getFirstAsync<{ position: number }>(
    "SELECT position FROM place_types WHERE owner_id IS NOT NULL ORDER BY position DESC LIMIT 1",
  );
  const position = last ? last.position + 1 : SYSTEM_PLACE_TYPE_COUNT;
  const fields = { name: draft.name, iconKey: draft.iconKey, color: draft.color, position };

  await withSyncTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO place_types
         (id, owner_id, name, icon_key, color, position, created_at, updated_at,
          extra_json, dirty_fields_json)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      id,
      draft.name,
      draft.iconKey,
      draft.color,
      position,
      now,
      now,
      JSON.stringify(Object.keys(fields)),
    );
    await appendOp(db, { opId: mintUuid(), entity: "placeType", op: "create", id, fields });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return id;
}

export async function updatePlaceTypeLocal(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await enqueueUpdate("placeType", "place_types", id, fields, PLACE_TYPE_UPDATE_COLUMNS);
}

/**
 * Delete a type of the user's own.
 *
 * The PLACES ON IT ARE NOT TOUCHED here — the server decides what happens to
 * them, and the phone must not invent a second answer. The editor counts them
 * first and says the number, the same way deleting a field definition does.
 */
export async function deletePlaceTypeLocal(id: string): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync("DELETE FROM place_types WHERE id = ?", id);
    await appendOp(db, { opId: mintUuid(), entity: "placeType", op: "delete", id });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

// ── place / trip update surface ─────────────────────────────────────────────
//
// Field-scoped updates over the generic enqueueUpdate path (§8.2 coalescing,
// §8.5 optimistic materialization). Only own rows are pushable: a shared
// place's update would 404 server-side and park deadRemote, so callers gate
// the edit UI on syncRole === "owner". These maps list ONLY scalar columns —
// array/object fields (altNames, attributes, types, customFields, place
// links) aren't materialized here because enqueueUpdate binds values raw.

const PLACE_UPDATE_COLUMNS: Record<string, ColumnSpec> = {
  name: "name",
  notes: "notes",
  latitude: "latitude",
  longitude: "longitude",
  placeTypeId: "place_type_id",
  // Folded in with the waypoints (phase 1c). `symbol` did not come: the icon
  // is the place TYPE's.
  elevation: "elevation",
  altNames: {
    column: "alt_names_json",
    encode: (value) => JSON.stringify(value ?? []),
    decode: (raw) => JSON.parse((raw as string | null) ?? "[]"),
  },
  // Every type-specific value, INCLUDING what used to be the seven grade
  // columns. Callers pass the WHOLE object — the server replaces it wholesale,
  // so an edit that drops a key another client put there loses it. Use
  // `setFieldValues` over the place's existing values rather than building a
  // fresh object, which also keeps the internal `_sources` entry that lives in
  // here now.
  //
  // `foreignFields` is deliberately ABSENT and must stay absent: it is written
  // only by copy and by a type change, never by a user edit, and it is not in
  // the server's PLACE_FIELDS allowlist either — an op carrying it is a 400.
  fieldValues: {
    column: "field_values_json",
    encode: (value) => JSON.stringify(value ?? {}),
    decode: (raw) => JSON.parse((raw as string | null) ?? "{}"),
  },
};

/** A place type's editable columns. Name, icon, colour and order — everything
 *  a user can change about a category they made. */
const PLACE_TYPE_UPDATE_COLUMNS: Record<string, ColumnSpec> = {
  name: "name",
  iconKey: "icon_key",
  color: "color",
  position: "position",
};

export async function updatePlaceLocal(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await enqueueUpdate("place", "places", id, fields, PLACE_UPDATE_COLUMNS);
}

/** The fields a place can be created with offline. Coordinates are required:
 * a place without a position isn't a place, and the server rejects it. */
export type PlaceDraftFields = {
  /** Client-minted id to reuse. Only the legacy-waypoint promotion passes one
   *  (see `migrateLegacyWaypoints`); every other caller lets one be minted. */
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Required: a place with no type has no form and no tab. */
  placeTypeId: string;
  altNames?: string[];
  notes?: string | null;
  /** Metres. Optional on every place; a dropped marker usually has one. */
  elevation?: number | null;
  /** Type-specific values, keyed by definition key — the seven grades
   *  included. Nulls are dropped rather than stored. */
  fieldValues?: Record<string, unknown>;
};

/**
 * Add a place offline: optimistic mirror row + a place.create op. Mirrors
 * createTripLocal — every field is locally dirty until the create flushes, and
 * the server row replaces the provisional timestamps.
 *
 * Validated with the same predicate the API applies (`validatePlacePayload`),
 * so a bad value fails here with a message rather than parking a deadRemote op
 * on the next flush.
 */
export async function createPlaceLocal(draft: PlaceDraftFields): Promise<string> {
  const id = draft.id ?? mintUuid();
  const now = new Date().toISOString();
  const altNames = draft.altNames ?? [];
  const fieldValues = setFieldValues({}, draft.fieldValues ?? {});
  const fields: Record<string, unknown> = {
    name: draft.name,
    latitude: draft.latitude,
    longitude: draft.longitude,
    placeTypeId: draft.placeTypeId,
    altNames,
    ...(draft.notes != null && { notes: draft.notes }),
    ...(draft.elevation != null && { elevation: draft.elevation }),
    ...(Object.keys(fieldValues).length > 0 && { fieldValues }),
  };

  // The system definitions are compiled in, so this bound check works with no
  // signal — which is the point: it stops a rejected op reaching the outbox
  // from a gorge. A value under a USER definition is checked server-side.
  const invalid = validatePlacePayload(fields, {
    requireCoords: true,
    defs: SYSTEM_FIELD_DEFS,
  });
  if (invalid) throw new Error(invalid);

  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO places
         (id, sync_role, name, latitude, longitude, alt_names_json,
          place_type_id, notes, elevation, field_values_json,
          field_defs_snapshot_json, foreign_fields_json, forked_from_id,
          created_at, updated_at, extra_json, dirty_fields_json)
       VALUES (?, 'owner', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?)`,
      id,
      draft.name,
      draft.latitude,
      draft.longitude,
      JSON.stringify(altNames),
      draft.placeTypeId,
      draft.notes ?? null,
      draft.elevation ?? null,
      JSON.stringify(fieldValues),
      now,
      now,
      JSON.stringify(Object.keys(fields)),
    );
    await appendOp(db, {
      opId: mintUuid(),
      entity: "place",
      op: "create",
      id,
      fields,
    });
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return id;
}


/**
 * Delete a place offline. Owner-only (the caller gates on syncRole): a
 * sharee's delete would 404 server-side and park deadRemote.
 *
 * The mirror-side cascade is `cascadePlaceDelete` — the SAME function the
 * server tombstone runs, so the two paths cannot diverge again. They did:
 * this path used to scrub links and shares only, leaving the place's media
 * rows, their cached blobs and `routes.place_id` behind until a later delta
 * pull cleaned up — i.e. never, for a guest, whose device is never registered
 * for pulls at all.
 */
export async function deletePlaceLocal(id: string): Promise<void> {
  const db = await getSyncDb();
  const orphanedPaths = await withSyncTransaction(db, async () => {
    const paths = await cascadePlaceDelete(db, id);
    await appendOp(db, {
      opId: mintUuid(),
      entity: "place",
      op: "delete",
      id,
    });
    return paths;
  });
  // Cached blobs: best-effort, outside the transaction (same as deltaPull).
  for (const path of orphanedPaths) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
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

export type TripDraftFields = {
  /** UTC-midnight ISO instant for a date-only value (CH-001). */
  date: string;
  displayName?: string | null;
  notes?: string | null;
  types?: string[];
  /** Values for the user's own field definitions, keyed by field key. */
  customFields?: Record<string, unknown>;
  /** Ordered; the mirror needs the names, the push op sends ids only. */
  places?: TripPlaceLink[];
};

/**
 * The place-links column spec. The push op carries ids (`placeIds`, what the
 * server resolves), but the mirror column stores `{id, name}` because the
 * derived trip title is built from names offline. So the caller has to supply
 * the names it already had on screen — there is no id→name lookup down here,
 * and a blank name would render a blank trip title.
 */
function placeLinksColumn(links: TripPlaceLink[]): ColumnSpec {
  const nameById = new Map(links.map((link) => [link.id, link.name]));
  return {
    column: "places_json",
    encode: (value) =>
      JSON.stringify(
        ((value ?? []) as string[]).map((placeId) => {
          const name = nameById.get(placeId);
          if (name == null) {
            throw new Error("Trip place link is missing its name for the mirror row");
          }
          return { id: placeId, name };
        }),
      ),
    decode: (raw) =>
      (JSON.parse((raw as string | null) ?? "[]") as TripPlaceLink[]).map(
        (link) => link.id,
      ),
  };
}

/**
 * Field-scoped trip update. `places` is translated into the `placeIds` op
 * field; every other key passes through as-is.
 */
export async function updateTripLocal(
  id: string,
  fields: Omit<Partial<TripDraftFields>, "places"> & { places?: TripPlaceLink[] },
): Promise<void> {
  const { places, ...scalar } = fields;
  const columns: Record<string, ColumnSpec> = { ...TRIP_UPDATE_COLUMNS };
  const opFields: Record<string, unknown> = { ...scalar };
  if (places !== undefined) {
    columns.placeIds = placeLinksColumn(places);
    opFields.placeIds = places.map((link) => link.id);
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
  const places = draft.places ?? [];
  const types = draft.types ?? [];
  const customFields = draft.customFields ?? {};
  const fields: Record<string, unknown> = {
    date: draft.date,
    types,
    placeIds: places.map((link) => link.id),
    ...(Object.keys(customFields).length > 0 && { customFields }),
    ...(draft.displayName != null && { displayName: draft.displayName }),
    ...(draft.notes != null && { notes: draft.notes }),
  };

  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO trip_logs
         (id, date, display_name, types_json, notes, custom_fields_json,
          places_json, created_at, updated_at, extra_json, dirty_fields_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      id,
      draft.date,
      draft.displayName ?? null,
      JSON.stringify(types),
      draft.notes ?? null,
      JSON.stringify(customFields),
      JSON.stringify(places),
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
  await withSyncTransaction(db, async () => {
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

// ── notification read-state + delete surface ─────────────────────────────────
//
// Notifications aren't in the delta protocol (§4.7 refetch-and-cache), so none
// of these has a mirror row to touch — the inbox cache is patched separately
// (patchCachedRead / removeCachedNotifications). They route through the SAME
// outbox as every other mutation so they survive offline: the ops flush on the
// next cycle, and every one of them is idempotent server-side. The shared
// planner keeps at most one read-state op per notification (the last one wins)
// and lets a delete cancel it.

export async function enqueueNotificationRead(
  ids: string[],
  /** False marks them UNREAD — the same op vocabulary in the other direction. */
  read = true,
): Promise<void> {
  if (ids.length === 0) return;
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    for (const id of ids) {
      await appendOp(db, {
        opId: mintUuid(),
        entity: "notification",
        op: read ? "markRead" : "markUnread",
        id,
      });
    }
  });
  scheduleMutationSync();
}

export async function enqueueNotificationDelete(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    for (const id of ids) {
      await appendOp(db, {
        opId: mintUuid(),
        entity: "notification",
        op: "delete",
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
async function appendOp(
  db: Db,
  incoming: SyncPushOp,
  /** Server-confirmed values for the fields this op newly dirties (§6
   * conflict base). An argument rather than module state: a throw inside the
   * enqueue transaction rolls SQLite back but not a JS variable, so a shared
   * mutable leaked the failed op's base map into whatever enqueued next. */
  baseSnapshot: Record<string, unknown> = {},
): Promise<void> {
  // planOutboxEnqueue inspects exactly two things: the incoming row's own
  // queued ops, and the queue TAIL (an update merges into an adjacent update
  // only — merging into anything earlier would reorder the queue). Reading the
  // whole outbox on every enqueue, JSON-parsing each row, made the guest→link
  // drain quadratic: a season of account-less use is thousands of ops, and a
  // route op carries its whole geometry.
  const rows = await db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox WHERE entity = ? AND entity_id = ?
     UNION
     SELECT * FROM outbox WHERE seq = (SELECT MAX(seq) FROM outbox)
     ORDER BY seq ASC`,
    incoming.entity,
    incoming.id,
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
    const mergedBase = { ...baseSnapshot, ...existingBase };
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
      Object.keys(baseSnapshot).length ? JSON.stringify(baseSnapshot) : null,
      new Date().toISOString(),
    );
  }
}

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
  await withSyncTransaction(db, async () => {
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

    await appendOp(
      db,
      {
        opId: mintUuid(),
        entity,
        op: "update",
        id,
        // Conflict DETECTION base (§6): the server updatedAt this edit saw.
        ...(typeof current.updated_at === "string" && {
          baseUpdatedAt: current.updated_at,
        }),
        fields,
      },
      baseSnapshot,
    );
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

// ── Stage 7 → Stage 8 waypoint migration ─────────────────────────────────────
//
// Stage 7 stored dropped waypoints in a local-only table (logjam-offline.db
// `waypoint`). Stage 8 made waypoints a synced entity; promote any legacy rows
// into the mirror + outbox once, then DROP the legacy table — a fresh install
// never creates it (it is no longer in SCHEMA_SQL), so its absence is the
// normal case and the promotion is a no-op from then on.
//
// Since the phase 1c fold they are promoted as PLACES of the system Marker
// type, which is what a waypoint is now. The path still has to exist: a phone
// that has been offline since Stage 7 still holds these rows, and they are
// points the user dropped in the field.

export async function migrateLegacyWaypoints(): Promise<void> {
  // Lazy import: keeps offline/ and sync/ decoupled at module load.
  const { getOfflineDb } = await import("../offline/registryDb");
  const legacyDb = await getOfflineDb();
  // Existence check rather than a swallowed error: a genuinely broken query
  // must still throw. Fresh installs take this branch on every launch.
  const present = await legacyDb.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'waypoint'",
  );
  if (!present) return;

  const rows = await legacyDb.getAllAsync<{
    id: string;
    name: string;
    lon: number;
    lat: number;
  }>("SELECT id, name, lon, lat FROM waypoint");
  const db = await getSyncDb();
  for (const row of rows) {
    // Crash-idempotent: the promoted place KEEPS the legacy id, so a kill
    // between the insert and the legacy DELETE (two different SQLite files —
    // no transaction can span them) replays onto the row it already wrote
    // instead of minting a second place and a second create op.
    // Stage 7 ids that aren't UUIDv4 can't be pushed at all, so those get a
    // fresh one and accept the (narrow) duplicate window.
    const id = isUuidV4(row.id) ? row.id : undefined;
    const already =
      id != null &&
      (await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM places WHERE id = ?",
        id,
      )) != null;
    if (!already) {
      await createPlaceLocal({
        id,
        name: row.name,
        latitude: row.lat,
        longitude: row.lon,
        // Marker, not Canyon: a dropped point is a marked position, and
        // filing it as a canyon would put it in the canyon tab and hand it
        // seven grade fields it will never have.
        placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
      });
    }
    await legacyDb.runAsync("DELETE FROM waypoint WHERE id = ?", row.id);
  }
  await legacyDb.execAsync("DROP TABLE IF EXISTS waypoint");
}

// ── discard-an-update revert ────────────────────────────────────────────────

type UpdateTarget = { table: string; columns: Record<string, ColumnSpec> };

/**
 * TOTAL over the push entities on purpose — `Partial<Record<…>>` let `route`
 * be forgotten, so discarding a rejected route edit left the refused geometry
 * on the map and the fields permanently dirty (every later pull replayed them
 * over the server row). A new entity now fails to compile until it answers
 * here; `notification` answers null because a markRead materializes nothing.
 */
export const UPDATE_TARGETS: Record<SyncPushEntity, UpdateTarget | null> = {
  place: { table: "places", columns: PLACE_UPDATE_COLUMNS },
  placeType: { table: "place_types", columns: PLACE_TYPE_UPDATE_COLUMNS },
  tripLog: { table: "trip_logs", columns: TRIP_UPDATE_COLUMNS },
  // A link has no fields, so there is no update op to discard and nothing to
  // put back. Null, not an empty column map: the difference is "cannot be
  // updated" versus "updatable, with no columns declared yet".
  placeLink: null,
  route: { table: "routes", columns: ROUTE_UPDATE_COLUMNS },
  customFieldDef: {
    table: "custom_field_defs",
    columns: CUSTOM_FIELD_DEF_UPDATE_COLUMNS,
  },
  notification: null,
};

/**
 * Put the mirror back the way it was before a DISCARDED update.
 *
 * `enqueueUpdate` materializes an edit into the mirror columns immediately, so
 * discarding the op has to undo that write — otherwise the rejected value sits
 * on screen indefinitely (the place keeps the name the server refused), and
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
      field === "placeIds" && entity === "tripLog"
        ? await placeLinksColumnFromMirror(db, value)
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

/** `placeLinksColumn` needs id→name, and a revert has only the ids the base
 * snapshot decoded to. The names are in the mirror's own places table. */
async function placeLinksColumnFromMirror(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  baseValue: unknown,
): Promise<ColumnSpec> {
  const ids = Array.isArray(baseValue) ? (baseValue as string[]) : [];
  const links: TripPlaceLink[] = [];
  for (const placeId of ids) {
    const place = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM places WHERE id = ?",
      placeId,
    );
    // A place the mirror no longer holds can't be named, so it can't be put
    // back — drop the link rather than write a blank trip title.
    if (place) links.push({ id: placeId, name: place.name });
  }
  return placeLinksColumn(links);
}

// ── restoring one shelved field ─────────────────────────────────────────────

/**
 * The update surface each entity actually has, keyed off the SAME column maps
 * the typed helpers above pass to `enqueueUpdate`. Deriving it is the point: a
 * field this map claimed and `enqueueUpdate` didn't would throw "Unknown field"
 * from inside a transaction, at the moment the user tapped Put this value back.
 *
 * `notification` has no updatable field (its ops are markRead/markUnread), and
 * a trip's `placeIds` is deliberately absent — its column is built per call
 * from resolved link names (`updateTripLocal`), so it is not restorable from a
 * shelved value alone and `canRestoreField` says so rather than guessing.
 */
const UPDATE_COLUMNS_BY_ENTITY: Record<
  SyncPushEntity,
  Record<string, ColumnSpec> | null
> = {
  place: PLACE_UPDATE_COLUMNS,
  placeType: PLACE_TYPE_UPDATE_COLUMNS,
  tripLog: TRIP_UPDATE_COLUMNS,
  placeLink: null,
  route: ROUTE_UPDATE_COLUMNS,
  customFieldDef: CUSTOM_FIELD_DEF_UPDATE_COLUMNS,
  notification: null,
};

/** Whether one field of one entity can be written by a local update op. */
export function canRestoreField(entity: string, field: string): boolean {
  const columns = UPDATE_COLUMNS_BY_ENTITY[entity as SyncPushEntity];
  return columns != null && Object.hasOwn(columns, field);
}

/**
 * The fields whose two conflicting values can be CONCATENATED instead of one
 * beating the other — the whole of "Keep both".
 *
 * Only `notes` qualifies, and that is a fact about the protocol rather than a
 * choice: joining two values with a blank line has to produce something the
 * field's own editor would have accepted, and every other conflictable field is
 * a name (a two-line place name is a broken place name), a number, or a blob.
 * Custom fields are not addressable here at all — a place's live inside
 * `attributes` and a trip's inside `customFields`, so a conflict on one is a
 * conflict on the WHOLE object and merging it is a key-by-key affair, not a
 * concatenation. That is the deferred case, not this one.
 *
 * Guarded by `outbox.unit.test.ts`: every entry must be a field
 * `canRestoreField` accepts for some entity, because Keep both writes through
 * `updateEntityFieldLocal` and a field only this set knew about would throw
 * from inside the transaction the user's tap opened.
 */
const MERGEABLE_TEXT_FIELDS = new Set(["notes"]);

/** Whether "Keep both" can join two values of this field with a blank line. */
export function canKeepBothField(entity: string, field: string): boolean {
  return MERGEABLE_TEXT_FIELDS.has(field) && canRestoreField(entity, field);
}

/** The mergeable field names, for the test that keeps the two lists honest. */
export function mergeableTextFields(): string[] {
  return [...MERGEABLE_TEXT_FIELDS];
}

/**
 * Write one field locally and queue the update — the generic behind
 * "Restore" and "Keep both". Callers gate first (`canRestoreField`, plus the
 * row's existence); this throws rather than guessing if they didn't.
 */
export async function updateEntityFieldLocal(
  entity: string,
  id: string,
  field: string,
  value: unknown,
): Promise<void> {
  const columns = UPDATE_COLUMNS_BY_ENTITY[entity as SyncPushEntity];
  const table = isOutboxEntity(entity) ? outboxMirrorTable(entity) : null;
  if (!columns || !table || !Object.hasOwn(columns, field)) {
    throw new Error(`Cannot restore ${entity}.${field}`);
  }
  await enqueueUpdate(entity as SyncPushEntity, table, id, { [field]: value }, columns);
}
