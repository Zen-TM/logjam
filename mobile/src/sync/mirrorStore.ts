// Mirror row mapping: delta wire rows ⇄ SQLite mirror tables (§9). Known
// fields land in typed columns; anything else the server sent is preserved
// verbatim in extra_json (additive protocol §10.3, display-only). Reads
// reassemble the client-facing shapes the screens already consume (TPlace /
// TTripLog compatible).
import type { SQLiteDatabase } from "expo-sqlite";
import type {
  SyncDeltaPlaceRow,
  SyncDeltaPlaceTypeRow,
  SyncDeltaCustomFieldDefRow,
  SyncDeltaFriendshipRow,
  SyncDeltaMediaRow,
  SyncDeltaShareRow,
  SyncDeltaTombstone,
  SyncEntityType,
  SyncDeltaTripRow,
  SyncDeltaPlaceLinkRow,
  SyncDeltaRouteRow,
  MediaMetadata,
} from "@logjam/shared";
import { isKnownSyncEntityType, readMediaMetadata } from "@logjam/shared";

import type { TPlace, TTripLog } from "../api/types";
import { withoutPlaceLink } from "./placeLinks";
import { getSyncDb, notifyMirrorChanged } from "./syncDb";

// ── extras split ─────────────────────────────────────────────────────────────

function splitExtras<Row extends Record<string, unknown>>(
  row: Row,
  knownKeys: readonly string[],
): string | null {
  const extras: Record<string, unknown> = {};
  let any = false;
  for (const [key, value] of Object.entries(row)) {
    if (!knownKeys.includes(key)) {
      extras[key] = value;
      any = true;
    }
  }
  return any ? JSON.stringify(extras) : null;
}

const PLACE_KNOWN = [
  "id", "syncRole", "name", "altNames", "latitude", "longitude",
  "placeTypeId", "notes", "elevation", "tags", "fieldValues",
  "fieldDefsSnapshot", "foreignFields", "forkedFromId", "createdAt",
  "updatedAt",
] as const;

const PLACE_TYPE_KNOWN = [
  "id", "ownerId", "name", "iconKey", "color", "position",
  "createdAt", "updatedAt",
] as const;

const TRIP_KNOWN = [
  "id", "date", "displayName", "types", "notes", "customFields",
  "places", "createdAt", "updatedAt",
] as const;

const PLACE_LINK_KNOWN = [
  "id", "ownerId", "aPlaceId", "bPlaceId", "createdAt", "updatedAt",
] as const;

const ROUTE_KNOWN = [
  "id", "ownerId", "placeId", "name", "color", "points", "syncRole",
  "sharedCount", "createdAt", "updatedAt",
] as const;

// `ownerId` is a known key that gets no column: every definition the server
// sends is the caller's own (they are never shared), so storing it would be a
// constant. It is listed here so it does not fall into extra_json.
const CUSTOM_FIELD_DEF_KNOWN = [
  "id", "ownerId", "entity", "key", "label", "type", "min", "max",
  "position", "createdAt", "updatedAt",
] as const;

const MEDIA_KNOWN = [
  "id", "linkedType", "linkedId", "mediaType", "filename", "displayName",
  "fileSizeBytes", "color", "origin", "metadata", "createdAt", "updatedAt",
] as const;

// ── upserts (called inside the delta-apply transaction) ─────────────────────
//
// Rebase-on-pull (§8.5) happens in deltaPull: it merges pending dirty fields
// over the server row BEFORE handing it here, and passes the surviving dirty
// field names for the dirty_fields_json column. No pending ops → dirtyFields
// is empty and columns hold pure server state.

export async function upsertPlace(
  db: SQLiteDatabase,
  row: SyncDeltaPlaceRow,
  dirtyFieldNames: string[],
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO places
       (id, sync_role, name, latitude, longitude, alt_names_json,
        place_type_id, notes, elevation, tags_json, field_values_json,
        field_defs_snapshot_json, foreign_fields_json, forked_from_id,
        created_at, updated_at, extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.syncRole,
    row.name,
    row.latitude,
    row.longitude,
    JSON.stringify(row.altNames ?? []),
    row.placeTypeId,
    row.notes,
    row.elevation ?? null,
    JSON.stringify(row.tags ?? []),
    JSON.stringify(row.fieldValues ?? {}),
    // Present only on a place of a type this account does not own — a shared
    // place of the sender's own type. Otherwise the viewer holds the
    // definitions themselves and needs no snapshot.
    row.fieldDefsSnapshot ? JSON.stringify(row.fieldDefsSnapshot) : null,
    // OWNER-PRIVATE: the server never emits it on a shared row, so anything
    // stored here belongs to this account.
    row.foreignFields ? JSON.stringify(row.foreignFields) : null,
    row.forkedFromId,
    row.createdAt,
    row.updatedAt,
    splitExtras(row, PLACE_KNOWN),
    dirtyFieldNames.length ? JSON.stringify(dirtyFieldNames) : null,
  );
}

export async function upsertPlaceType(
  db: SQLiteDatabase,
  row: SyncDeltaPlaceTypeRow,
  dirtyFieldNames: string[],
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO place_types
       (id, owner_id, name, icon_key, color, position, created_at, updated_at,
        extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    // NULL means a SYSTEM type — global, shared by every account, not this
    // user's. Storing it verbatim rather than coercing to "" keeps that
    // distinction readable at every call site.
    row.ownerId,
    row.name,
    row.iconKey,
    row.color,
    row.position,
    row.createdAt,
    row.updatedAt,
    splitExtras(row, PLACE_TYPE_KNOWN),
    dirtyFieldNames.length ? JSON.stringify(dirtyFieldNames) : null,
  );
}

export async function upsertTrip(
  db: SQLiteDatabase,
  row: SyncDeltaTripRow,
  dirtyFieldNames: string[],
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO trip_logs
       (id, date, display_name, types_json, notes, custom_fields_json,
        places_json, created_at, updated_at, extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.date,
    row.displayName,
    JSON.stringify(row.types ?? []),
    row.notes,
    JSON.stringify(row.customFields ?? {}),
    JSON.stringify(row.places ?? []),
    row.createdAt,
    row.updatedAt,
    splitExtras(row, TRIP_KNOWN),
    dirtyFieldNames.length ? JSON.stringify(dirtyFieldNames) : null,
  );
}

/**
 * A trip's pending place-link edit, rebased onto a fresh server row.
 *
 * The push op carries `placeIds: string[]` while the delta row carries
 * `places: {id,name}[]`, so the generic rebase — which merges op fields over
 * row fields BY NAME — never overrode the link list: the server's value won
 * and `placeIds` fell through into `extra_json` as junk. Re-link a trip
 * offline and the next pull visibly snapped it back.
 *
 * The local mirror column already holds the edit complete with names (that is
 * what `updateTripLocal` wrote), so the rebase keeps the local column rather
 * than trying to resolve id→name here.
 */
export async function rebasePendingPlaceLinks(
  db: SQLiteDatabase,
  row: SyncDeltaTripRow,
  dirtyNames: string[],
): Promise<{ effective: SyncDeltaTripRow; dirtyNames: string[] }> {
  if (!dirtyNames.includes("placeIds")) return { effective: row, dirtyNames };
  const local = await db.getFirstAsync<{ places_json: string | null }>(
    "SELECT places_json FROM trip_logs WHERE id = ?",
    row.id,
  );
  const { placeIds: _discard, ...rest } = row as SyncDeltaTripRow & {
    placeIds?: unknown;
  };
  return {
    effective: {
      ...rest,
      places: local?.places_json
        ? (JSON.parse(local.places_json) as SyncDeltaTripRow["places"])
        : row.places,
    },
    dirtyNames: dirtyNames.map((name) => (name === "placeIds" ? "places" : name)),
  };
}

export async function upsertPlaceLink(
  db: SQLiteDatabase,
  row: SyncDeltaPlaceLinkRow,
  dirtyFieldNames: string[],
): Promise<void> {
  // No sharedCount carry-forward here (unlike routes): a link is owner-private,
  // so there is no fan-out to report and no field the write-path response could
  // omit.
  await db.runAsync(
    `INSERT OR REPLACE INTO place_links
       (id, owner_id, a_place_id, b_place_id, created_at, updated_at,
        extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.ownerId,
    row.aPlaceId,
    row.bPlaceId,
    row.createdAt,
    row.updatedAt,
    splitExtras(row, PLACE_LINK_KNOWN),
    dirtyFieldNames.length ? JSON.stringify(dirtyFieldNames) : null,
  );
}

export async function upsertRoute(
  db: SQLiteDatabase,
  row: SyncDeltaRouteRow,
  dirtyFieldNames: string[],
): Promise<void> {
  // Absent sharedCount means "unchanged", not
  // zero — carry the stored count forward rather than nulling it (see the
  // comment there).
  const sharedCount =
    row.sharedCount !== undefined
      ? row.sharedCount
      : (
          await db.getFirstAsync<{ shared_count: number | null }>(
            "SELECT shared_count FROM routes WHERE id = ?",
            row.id,
          )
        )?.shared_count ?? null;
  await db.runAsync(
    `INSERT OR REPLACE INTO routes
       (id, owner_id, place_id, name, color, points_json, anchors_json,
        sync_role, shared_count, created_at, updated_at, extra_json,
        dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.ownerId,
    row.placeId,
    row.name,
    row.color,
    JSON.stringify(row.points),
    row.anchors == null ? null : JSON.stringify(row.anchors),
    row.syncRole,
    sharedCount,
    row.createdAt,
    row.updatedAt,
    splitExtras(row, ROUTE_KNOWN),
    dirtyFieldNames.length ? JSON.stringify(dirtyFieldNames) : null,
  );
}

export async function upsertCustomFieldDef(
  db: SQLiteDatabase,
  row: SyncDeltaCustomFieldDefRow,
  dirtyFieldNames: string[],
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO custom_field_defs
       (id, entity, key, label, type, min, max, position, created_at,
        updated_at, extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.entity,
    row.key,
    row.label,
    row.type,
    row.min,
    row.max,
    row.position,
    row.createdAt,
    row.updatedAt,
    splitExtras(row, CUSTOM_FIELD_DEF_KNOWN),
    dirtyFieldNames.length ? JSON.stringify(dirtyFieldNames) : null,
  );
}

export async function upsertMedia(
  db: SQLiteDatabase,
  row: SyncDeltaMediaRow,
): Promise<void> {
  // Preserve local cache/upload columns across re-delivery: INSERT OR
  // REPLACE would null local_display_path etc., so update-then-insert.
  const updated = await db.runAsync(
    `UPDATE media SET linked_type = ?, linked_id = ?, media_type = ?,
       filename = ?, display_name = ?, file_size_bytes = ?, color = ?,
       origin = ?, metadata_json = ?, created_at = ?, updated_at = ?,
       extra_json = ?, sync_state = 'synced'
     WHERE id = ?`,
    row.linkedType,
    row.linkedId,
    row.mediaType,
    row.filename,
    row.displayName,
    row.fileSizeBytes,
    row.color,
    row.origin,
    JSON.stringify(row.metadata ?? {}),
    row.createdAt,
    row.updatedAt,
    splitExtras(row, MEDIA_KNOWN),
    row.id,
  );
  if (updated.changes === 0) {
    await db.runAsync(
      `INSERT INTO media
         (id, linked_type, linked_id, media_type, filename, display_name,
          file_size_bytes, color, origin, metadata_json, created_at, updated_at,
          extra_json, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
      row.id,
      row.linkedType,
      row.linkedId,
      row.mediaType,
      row.filename,
      row.displayName,
      row.fileSizeBytes,
      row.color,
      row.origin,
      JSON.stringify(row.metadata ?? {}),
      row.createdAt,
      row.updatedAt,
      splitExtras(row, MEDIA_KNOWN),
    );
  }
}

export async function upsertShare(
  db: SQLiteDatabase,
  row: SyncDeltaShareRow,
  currentUserId: string,
): Promise<void> {
  const outgoing = row.sharedById === currentUserId;
  const counterpart = outgoing ? row.sharedWith : row.sharedBy;
  await db.runAsync(
    `INSERT OR REPLACE INTO place_shares
       (id, place_id, direction, counterpart_user_id, counterpart_username,
        created_at, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    row.id,
    row.placeId,
    outgoing ? "out" : "in",
    counterpart.id,
    counterpart.username,
    row.createdAt,
  );
}

export async function upsertFriendship(
  db: SQLiteDatabase,
  row: SyncDeltaFriendshipRow,
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO friendships
       (id, status, direction, counterpart_user_id, counterpart_username,
        created_at, updated_at, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    row.id,
    row.status,
    row.direction,
    row.counterpart.id,
    row.counterpart.username,
    row.createdAt,
    row.updatedAt,
  );
}

// ── place link cascade ──────────────────────────────────────────────────────

/**
 * Take a dead place out of the mirror's JSON link columns.
 *
 * Only TRIPS carry one now: place↔place links became rows of their own in the
 * phase 1c fold (`place_links`, deleted by the cascade above), while a trip
 * still carries its places with their names because the derived title is built
 * offline.
 *
 * The history is worth keeping, because it is what this function is FOR: the
 * cascade once nulled a `waypoints.place_id` column that no longer existed on
 * any fresh install, which threw inside the delta transaction, took the cursor
 * write down with the rollback, and froze the whole pull loop on the first
 * place delete the account ever saw. Both the server tombstone and the local
 * delete route through here so the two cannot differ again.
 */
export async function scrubPlaceLinks(
  db: SQLiteDatabase,
  placeId: string,
): Promise<void> {
  // LIKE narrows the rewrite to candidate rows (it matches substrings too, so
  // the helpers decide); the alternative is parsing every trip on the phone.
  const trips = await db.getAllAsync<{ id: string; places_json: string | null }>(
    "SELECT id, places_json FROM trip_logs WHERE places_json LIKE ?",
    `%${placeId}%`,
  );
  for (const trip of trips) {
    const next = withoutPlaceLink(trip.places_json, placeId);
    if (next === null) continue;
    await db.runAsync(
      "UPDATE trip_logs SET places_json = ? WHERE id = ?",
      next,
      trip.id,
    );
  }
}

// ── tombstone apply (§9 local cascade) ───────────────────────────────────────
//
// Returns local file paths of cached media blobs the caller must delete
// AFTER the transaction commits (filesystem I/O doesn't belong inside it).

/** Cached-blob paths of the media rows a `WHERE` clause selects. */
async function collectMediaPaths(
  db: SQLiteDatabase,
  where: string,
  ...args: string[]
): Promise<string[]> {
  const rows = await db.getAllAsync<{
    local_display_path: string | null;
    local_thumb_path: string | null;
  }>(
    `SELECT local_display_path, local_thumb_path FROM media WHERE ${where}`,
    ...args,
  );
  const paths: string[] = [];
  for (const row of rows) {
    if (row.local_display_path) paths.push(row.local_display_path);
    if (row.local_thumb_path) paths.push(row.local_thumb_path);
  }
  return paths;
}

/**
 * The place delete cascade, declared once. Both paths that remove a place
 * from the mirror — the server tombstone and the local owner delete
 * (`deletePlaceLocal`) — call this, because they diverged before: the local
 * path left the place's media rows and their cached blobs on disk (forever
 * for a guest, who is never registered for delta pulls) and left
 * `routes.place_id` dangling.
 *
 * Returns cached blob paths to unlink AFTER the transaction commits.
 */
export async function cascadePlaceDelete(
  db: SQLiteDatabase,
  placeId: string,
): Promise<string[]> {
  // Belt and braces both ends: the server fans out media tombstones too,
  // but the local cascade must not depend on their delivery order.
  const orphanedPaths = await collectMediaPaths(
    db,
    "linked_type = 'place' AND linked_id = ?",
    placeId,
  );
  await db.runAsync(
    "DELETE FROM media WHERE linked_type = 'place' AND linked_id = ?",
    placeId,
  );
  await db.runAsync("DELETE FROM places WHERE id = ?", placeId);
  await db.runAsync("DELETE FROM place_shares WHERE place_id = ?", placeId);
  // The links touching it go with it — server-side they cascade, and their
  // tombstones arrive too, but the local cascade must not depend on delivery
  // order. The place at the OTHER end survives: a link is not a container.
  await db.runAsync(
    "DELETE FROM place_links WHERE a_place_id = ? OR b_place_id = ?",
    placeId,
    placeId,
  );
  // Route place links are SetNull server-side; mirror matches.
  await db.runAsync(
    "UPDATE routes SET place_id = NULL WHERE place_id = ?",
    placeId,
  );
  await scrubPlaceLinks(db, placeId);
  return orphanedPaths;
}

export async function applyTombstone(
  db: SQLiteDatabase,
  tombstone: SyncDeltaTombstone,
): Promise<string[]> {
  const orphanedPaths: string[] = [];

  // A type this build has never heard of belongs to a NEWER SERVER, and there
  // is by definition no local table it could name — so forget it quietly and
  // let the cursor advance. Returning early (rather than falling through to the
  // switch) is also what keeps the `never` check below meaningful: the switch
  // now sees only entities this build knows, so a ninth one added HERE still
  // fails to compile until it is handled.
  if (!isKnownSyncEntityType(tombstone.type)) return orphanedPaths;
  const type: SyncEntityType = tombstone.type;

  switch (type) {
    case "place": {
      orphanedPaths.push(...(await cascadePlaceDelete(db, tombstone.id)));
      break;
    }
    case "tripLog": {
      orphanedPaths.push(
        ...(await collectMediaPaths(
          db,
          "linked_type = 'tripLog' AND linked_id = ?",
          tombstone.id,
        )),
      );
      await db.runAsync(
        "DELETE FROM media WHERE linked_type = 'tripLog' AND linked_id = ?",
        tombstone.id,
      );
      await db.runAsync("DELETE FROM trip_logs WHERE id = ?", tombstone.id);
      break;
    }
    case "media": {
      orphanedPaths.push(...(await collectMediaPaths(db, "id = ?", tombstone.id)));
      await db.runAsync("DELETE FROM media WHERE id = ?", tombstone.id);
      break;
    }
    case "placeShare":
      await db.runAsync("DELETE FROM place_shares WHERE id = ?", tombstone.id);
      break;
    case "friendship":
      await db.runAsync("DELETE FROM friendships WHERE id = ?", tombstone.id);
      break;
    case "placeLink":
      // Just the link. Both places survive — deleting one because it lost a
      // link would be the "a link is a container" mistake this model rejects.
      await db.runAsync("DELETE FROM place_links WHERE id = ?", tombstone.id);
      break;
    case "route":
      // Also the signal for "unlinked from a place you can see" — the route
      // still exists for its owner, but this user must forget it.
      await db.runAsync("DELETE FROM routes WHERE id = ?", tombstone.id);
      break;
    case "placeType":
      // Only the type row. The definitions scoped ONLY to it were deleted
      // server-side in the same transaction and arrive as their own tombstones;
      // the places that used it cannot exist, because a type holding places
      // refuses to be deleted at all.
      await db.runAsync("DELETE FROM place_types WHERE id = ?", tombstone.id);
      break;
    case "customFieldDef":
      // Only the definition. The VALUES it described were stripped server-side
      // in the same transaction as the delete, and reach this device as
      // ordinary updates to the trip_logs / places rows that carried them —
      // so cascading a value strip here would be a second, racing writer of
      // rows the delta already owns.
      await db.runAsync(
        "DELETE FROM custom_field_defs WHERE id = ?",
        tombstone.id,
      );
      break;
    default: {
      // An entity this build KNOWS but does not handle here would match no
      // case, delete nothing, and still advance the cursor — the copy would sit
      // in the mirror forever. The compiler answers instead. (A type this build
      // does not know returned above; that one is not a bug.)
      const unhandled: never = type;
      // Loud, but not a rollback: throwing here would abort the whole delta
      // page and freeze the cursor forever — the exact failure this mirror's
      // drop-and-rebuild lever exists to avoid. The compile error above is
      // the guard; this is only the belt.
      console.error(`sync: unhandled tombstone type ${String(unhandled)}`);
      break;
    }
  }

  // Pending local ops on a server-deleted row: delete wins (§6); park them
  // deadRemote so the parked-ops UI can offer "recreate from local copy".
  //
  // A pending local DELETE is the exception — it wanted exactly what just
  // happened. Parking it raised a permanent "needs your attention" issue for
  // work already done (delete the place on the phone offline, delete it on
  // the web too, and the phone demanded a decision about it forever), whose
  // only resolution was Discard. Drop it instead: goal state reached.
  await db.runAsync(
    "DELETE FROM outbox WHERE entity_id = ? AND op = 'delete'",
    tombstone.id,
  );
  await db.runAsync(
    `UPDATE outbox SET state = 'deadRemote'
     WHERE entity_id = ? AND state IN ('queued', 'blocked')`,
    tombstone.id,
  );

  return orphanedPaths;
}

// ── reads (screen-facing) ────────────────────────────────────────────────────

type PlaceRow = {
  id: string;
  sync_role: string;
  name: string;
  latitude: number;
  longitude: number;
  alt_names_json: string | null;
  place_type_id: string;
  notes: string | null;
  elevation: number | null;
  tags_json: string | null;
  field_values_json: string | null;
  field_defs_snapshot_json: string | null;
  foreign_fields_json: string | null;
  created_at: string | null;
  updated_at: string | null;
  extra_json: string | null;
};

export type MirrorPlace = TPlace & {
  syncRole: "owner" | "shared";
  /** Definitions for a shared place of a type this account does not own, so
   *  its values render with labels rather than bare keys. Absent otherwise. */
  fieldDefsSnapshot?: {
    key: string;
    label: string;
    type: string;
    min?: number | null;
    max?: number | null;
  }[];
};

/** A place type as mirrored. `ownerId: null` means a SYSTEM type — global and
 *  not editable — which a client must not read as "mine". */
export type MirrorPlaceType = {
  id: string;
  ownerId: string | null;
  name: string;
  iconKey: string;
  color: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Tolerant of the pre-tags rows an upgraded install still holds (null column
 * reads as an empty list, never as a crash on the map screen). */
function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function rowToPlace(row: PlaceRow): MirrorPlace {
  const extras = parseJson<Record<string, unknown>>(row.extra_json, {});
  return {
    // Extras first — typed columns are authoritative for known fields.
    ...(extras as Partial<TPlace>),
    id: row.id,
    ownerId: (extras.ownerId as string) ?? "",
    syncRole: row.sync_role === "owner" ? "owner" : "shared",
    name: row.name,
    altNames: parseJson<string[]>(row.alt_names_json, []),
    latitude: row.latitude,
    longitude: row.longitude,
    placeTypeId: row.place_type_id,
    notes: row.notes,
    elevation: row.elevation,
    tags: parseStringList(row.tags_json),
    fieldValues: parseJson(row.field_values_json, {}),
    fieldDefsSnapshot: row.field_defs_snapshot_json
      ? parseJson(row.field_defs_snapshot_json, [])
      : undefined,
    foreignFields: row.foreign_fields_json
      ? parseJson(row.foreign_fields_json, [])
      : null,
    ropeWikiId: (extras.ropeWikiId as number | null) ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

/** A definition row as stored. `customFieldDefsFromRows` turns these into the
 *  `TripLogCustomFieldDef`s the UI works in. */
export type MirrorCustomFieldDef = {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: string;
  min: number | null;
  max: number | null;
  position: number;
};

/** Every definition on this device, both entities. The ORDER BY matches the
 *  server's so a locally-created row sits where the pull will put it. */
export async function listMirrorCustomFieldDefs(): Promise<
  MirrorCustomFieldDef[]
> {
  const db = await getSyncDb();
  return db.getAllAsync<MirrorCustomFieldDef>(
    `SELECT id, entity, key, label, type, min, max, position
       FROM custom_field_defs ORDER BY position ASC, key ASC`,
  );
}

export async function listMirrorPlaces(): Promise<MirrorPlace[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<PlaceRow>(
    "SELECT * FROM places ORDER BY name COLLATE NOCASE ASC",
  );
  return rows.map(rowToPlace);
}

export async function getMirrorPlace(id: string): Promise<MirrorPlace | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<PlaceRow>(
    "SELECT * FROM places WHERE id = ?",
    id,
  );
  return row ? rowToPlace(row) : null;
}

type TripRow = {
  id: string;
  date: string;
  display_name: string | null;
  types_json: string | null;
  notes: string | null;
  custom_fields_json: string | null;
  places_json: string;
  created_at: string | null;
  updated_at: string | null;
  extra_json: string | null;
};

export type MirrorTrip = TTripLog & { updatedAt: string };

function rowToTrip(row: TripRow): MirrorTrip {
  const extras = parseJson<Record<string, unknown>>(row.extra_json, {});
  return {
    ...(extras as Partial<TTripLog>),
    id: row.id,
    userId: (extras.userId as string) ?? "",
    date: row.date,
    displayName: row.display_name,
    types: parseJson<string[]>(row.types_json, []),
    notes: row.notes,
    customFields: parseJson(row.custom_fields_json, {}),
    places: parseJson<{ id: string; name: string }[]>(row.places_json, []),
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export async function listMirrorTrips(): Promise<MirrorTrip[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<TripRow>(
    "SELECT * FROM trip_logs ORDER BY date DESC, created_at DESC",
  );
  return rows.map(rowToTrip);
}

export async function getMirrorTrip(id: string): Promise<MirrorTrip | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<TripRow>(
    "SELECT * FROM trip_logs WHERE id = ?",
    id,
  );
  return row ? rowToTrip(row) : null;
}

export type MirrorMedia = {
  id: string;
  linkedType: string;
  /** Null on a standalone file — an import or a recording, owned by nobody
   *  but this account. */
  linkedId: string | null;
  mediaType: string;
  filename: string | null;
  /** User-facing label; null falls back to the filename (mediaDisplayName). */
  displayName: string | null;
  color: string | null;
  /** "import" | "track" on a standalone file, null on an attachment. */
  origin: string | null;
  /** Row-level stats — bbox, distance, counts. `{}` when there are none. */
  metadata: MediaMetadata;
  fileSizeBytes: number | null;
  createdAt: string;
  syncState: string;
  localThumbPath: string | null;
  /** Null means the blob is not on THIS phone yet, not that it is missing:
   *  rows sync eagerly and bytes are fetched on demand (§7.3). */
  localDisplayPath: string | null;
};

/**
 * Attachment tally per linked row, for a list that wants to show "this entry
 * has photos" without loading every media row. One grouped read rather than a
 * query per visible row.
 */
/**
 * How many people each of the viewer's own places is shared WITH, keyed by
 * place id. Derived from the mirrored `place_shares` rows so the "Shared with
 * N" badge works offline — the server's `_count.shares` never reaches the
 * mirror.
 *
 * Outgoing only: an incoming share is the row that made a place visible to
 * the viewer, not evidence of their own fan-out. Places with no share have no
 * key, which is what "not shared" reads as.
 */
export async function countOutgoingSharesByPlace(): Promise<Record<string, number>> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{ place_id: string; n: number }>(
    `SELECT place_id, COUNT(*) AS n FROM place_shares
     WHERE direction = 'out'
     GROUP BY place_id`,
  );
  return Object.fromEntries(rows.map((row) => [row.place_id, row.n]));
}

/**
 * Who shared each INCOMING place with the viewer, keyed by place id. The
 * counterpart on a `direction = 'in'` row is the owner, and a place has one
 * owner, so there is at most one row per place here.
 *
 * The mirror side of the "From <name>" mark a shared route or waypoint wears in
 * Saved: the sync delta never carries an owner username on the asset rows
 * themselves, but it does carry it on the share row that made them visible.
 */
export async function incomingShareOwnerByPlace(): Promise<Record<string, string>> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{ place_id: string; counterpart_username: string | null }>(
    `SELECT place_id, counterpart_username FROM place_shares WHERE direction = 'in'`,
  );
  return Object.fromEntries(
    rows.flatMap((row) =>
      row.counterpart_username ? [[row.place_id, row.counterpart_username]] : [],
    ),
  );
}

// ── media rows ──────────────────────────────────────────────────────────────
//
// One column list and one mapper for every media read. Three call sites spelled
// the same SELECT and the same row→object map by hand, so adding a column meant
// finding all three — and a reader that missed one returned a MirrorMedia with
// the new field silently undefined.

/** Every media column the app reads, in one place. */
const MEDIA_SELECT = `id, linked_type, linked_id, media_type, filename,
            display_name, file_size_bytes, color, origin, metadata_json,
            created_at, sync_state, local_thumb_path, local_display_path`;

type MediaSqlRow = {
  id: string;
  linked_type: string;
  linked_id: string | null;
  media_type: string;
  filename: string | null;
  display_name: string | null;
  file_size_bytes: string | null;
  color: string | null;
  origin: string | null;
  metadata_json: string | null;
  created_at: string | null;
  sync_state: string;
  local_thumb_path: string | null;
  local_display_path: string | null;
};

function rowToMirrorMedia(row: MediaSqlRow): MirrorMedia {
  let metadata: MediaMetadata = {};
  if (row.metadata_json) {
    try {
      metadata = readMediaMetadata(row.origin, JSON.parse(row.metadata_json));
    } catch {
      // A row written by a build that stored something else. Stats are
      // decoration; the file still has a name and a size, and a list that
      // threw here would take the whole Saved tab down.
      metadata = {};
    }
  }
  return {
    id: row.id,
    linkedType: row.linked_type,
    linkedId: row.linked_id,
    mediaType: row.media_type,
    filename: row.filename,
    displayName: row.display_name,
    color: row.color,
    origin: row.origin,
    metadata,
    fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    createdAt: row.created_at ?? "",
    syncState: row.sync_state,
    localThumbPath: row.local_thumb_path,
    localDisplayPath: row.local_display_path,
  };
}

export async function countMediaByLinkedId(
  linkedType: string,
): Promise<Record<string, number>> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{ linked_id: string; n: number }>(
    `SELECT linked_id, COUNT(*) AS n FROM media
     WHERE linked_type = ? AND sync_state != 'pendingDelete'
     GROUP BY linked_id`,
    linkedType,
  );
  return Object.fromEntries(rows.map((row) => [row.linked_id, row.n]));
}

export async function listMediaForLinked(
  linkedType: string,
  linkedId: string,
): Promise<MirrorMedia[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<MediaSqlRow>(
    `SELECT ${MEDIA_SELECT}
     FROM media WHERE linked_type = ? AND linked_id = ?
       AND sync_state != 'pendingDelete'
     ORDER BY created_at ASC`,
    linkedType,
    linkedId,
  );
  return rows.map(rowToMirrorMedia);
}

/**
 * The account's standalone files of one kind — the Saved tab's Imports and
 * Tracks lists.
 *
 * Rows arrive from the delta whether or not their blob has been downloaded, so
 * a file imported on another device lists here with `localDisplayPath` null.
 * That is the intended state, not a broken row: the bytes are fetched when the
 * user opens it or puts it on the map.
 */
export async function listStandaloneMedia(
  origin: "import" | "track",
): Promise<MirrorMedia[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<MediaSqlRow>(
    `SELECT ${MEDIA_SELECT}
     FROM media WHERE origin = ? AND sync_state != 'pendingDelete'
     ORDER BY created_at DESC`,
    origin,
  );
  return rows.map(rowToMirrorMedia);
}

/** One media row by id, or null. */
export async function getMediaById(id: string): Promise<MirrorMedia | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<MediaSqlRow>(
    `SELECT ${MEDIA_SELECT} FROM media WHERE id = ?`,
    id,
  );
  return row ? rowToMirrorMedia(row) : null;
}

/**
 * Every place route attachment (.gpx/.kml) the mirror knows about — the map's
 * "Place routes" layer.
 *
 * Read from the MIRROR rather than `GET /places/tracks` (which is what the web
 * map uses): the rows and, for anything the user has looked at, the files are
 * already on the device, so the layer draws in a place with no signal. It also
 * means the feature adds no new server call and no new coordinate traffic.
 */
export async function listPlaceTrackMedia(
  trackMimeTypes: readonly string[],
): Promise<MirrorMedia[]> {
  const db = await getSyncDb();
  const placeholders = trackMimeTypes.map(() => "?").join(", ");
  const rows = await db.getAllAsync<MediaSqlRow>(
    `SELECT ${MEDIA_SELECT}
     FROM media
     WHERE linked_type = 'place' AND media_type IN (${placeholders})
       AND sync_state != 'pendingDelete'
     ORDER BY created_at ASC`,
    ...trackMimeTypes,
  );
  return rows.map(rowToMirrorMedia);
}

type PlaceLinkRow = {
  id: string;
  owner_id: string | null;
  a_place_id: string;
  b_place_id: string;
  created_at: string | null;
  updated_at: string | null;
};

/** One link, as stored. Symmetric: `aPlaceId` is simply the lower id, and a
 *  screen renders it from whichever end the user is standing on. */
export type MirrorPlaceLink = {
  id: string;
  ownerId: string | null;
  aPlaceId: string;
  bPlaceId: string;
  createdAt: string;
  updatedAt: string;
};

function rowToPlaceLink(row: PlaceLinkRow): MirrorPlaceLink {
  return {
    id: row.id,
    ownerId: row.owner_id,
    aPlaceId: row.a_place_id,
    bPlaceId: row.b_place_id,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export async function listMirrorPlaceLinks(): Promise<MirrorPlaceLink[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<PlaceLinkRow>(
    "SELECT * FROM place_links ORDER BY created_at DESC",
  );
  return rows.map(rowToPlaceLink);
}

/** The other end of every link touching `placeId` — what the detail screen's
 *  "Linked places" section reads. */
export async function linkedPlaceIdsFor(placeId: string): Promise<string[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{ a_place_id: string; b_place_id: string }>(
    "SELECT a_place_id, b_place_id FROM place_links WHERE a_place_id = ? OR b_place_id = ?",
    placeId,
    placeId,
  );
  return rows.map((row) =>
    row.a_place_id === placeId ? row.b_place_id : row.a_place_id,
  );
}

type RouteRow = {
  id: string;
  owner_id: string | null;
  place_id: string | null;
  name: string;
  color: string | null;
  points_json: string;
  anchors_json: string | null;
  sync_role: string | null;
  shared_count: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MirrorRoute = {
  id: string;
  ownerId: string | null;
  placeId: string | null;
  name: string;
  color: string | null;
  points: [number, number][];
  /** Indices into `points` the user placed; null means "no record". */
  anchors: number[] | null;
  /** 'shared' means this arrived through a place share — read-only here. */
  syncRole: string | null;
  /** See MirrorWaypoint.sharedCount — null is "not applicable", 0 is "nobody". */
  sharedCount: number | null;
  createdAt: string;
  updatedAt: string;
};

function rowToRoute(row: RouteRow): MirrorRoute {
  let points: [number, number][] = [];
  try {
    const parsed: unknown = JSON.parse(row.points_json);
    if (Array.isArray(parsed)) points = parsed as [number, number][];
  } catch {
    // A row we can't parse draws as nothing rather than crashing the map. The
    // next delta overwrites it; never log the contents (they are coordinates).
    points = [];
  }
  let anchors: number[] | null = null;
  if (typeof row.anchors_json === "string") {
    try {
      const parsed: unknown = JSON.parse(row.anchors_json);
      if (Array.isArray(parsed)) anchors = parsed as number[];
    } catch {
      // Unparseable reads as "no record", which degrades to every point being
      // an anchor — the same as a route drawn before snapping existed.
      anchors = null;
    }
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    placeId: row.place_id,
    name: row.name,
    color: row.color,
    points,
    anchors,
    syncRole: row.sync_role,
    sharedCount: row.shared_count,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export async function listMirrorRoutes(): Promise<MirrorRoute[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<RouteRow>(
    "SELECT * FROM routes ORDER BY created_at DESC",
  );
  return rows.map(rowToRoute);
}

/** True once any delta page has ever been applied (first-sync gate). */
export async function hasMirrorSynced(): Promise<boolean> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = 'lastSyncAt'",
  );
  return row != null;
}

export { notifyMirrorChanged };
