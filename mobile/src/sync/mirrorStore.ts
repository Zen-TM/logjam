// Mirror row mapping: delta wire rows ⇄ SQLite mirror tables (§9). Known
// fields land in typed columns; anything else the server sent is preserved
// verbatim in extra_json (additive protocol §10.3, display-only). Reads
// reassemble the client-facing shapes the screens already consume (TCanyon /
// TTripLog compatible).
import type { SQLiteDatabase } from "expo-sqlite";
import type {
  SyncDeltaCanyonRow,
  SyncDeltaFriendshipRow,
  SyncDeltaMediaRow,
  SyncDeltaShareRow,
  SyncDeltaTombstone,
  SyncDeltaTripRow,
  SyncDeltaWaypointRow,
  SyncDeltaRouteRow,
} from "@logjam/shared";

import type { TCanyon, TTripLog } from "../api/types";
import { withoutCanyonId, withoutCanyonLink } from "./canyonLinks";
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

const CANYON_KNOWN = [
  "id", "syncRole", "name", "altNames", "latitude", "longitude",
  "numAbseils", "longestAbseil", "vGrade", "aGrade", "commitment",
  "quality", "hours", "notes", "attributes", "forkedFromId",
  "createdAt", "updatedAt",
] as const;

const TRIP_KNOWN = [
  "id", "date", "displayName", "types", "notes", "customFields",
  "canyons", "createdAt", "updatedAt",
] as const;

const WAYPOINT_KNOWN = [
  "id", "ownerId", "canyonIds", "tags", "syncRole", "name", "latitude",
  "longitude", "elevation", "symbol", "notes", "createdAt", "updatedAt",
] as const;

const ROUTE_KNOWN = [
  "id", "ownerId", "canyonId", "name", "color", "points", "syncRole",
  "createdAt", "updatedAt",
] as const;

const MEDIA_KNOWN = [
  "id", "linkedType", "linkedId", "mediaType", "filename",
  "fileSizeBytes", "color", "createdAt",
] as const;

// ── upserts (called inside the delta-apply transaction) ─────────────────────
//
// Rebase-on-pull (§8.5) happens in deltaPull: it merges pending dirty fields
// over the server row BEFORE handing it here, and passes the surviving dirty
// field names for the dirty_fields_json column. No pending ops → dirtyFields
// is empty and columns hold pure server state.

export async function upsertCanyon(
  db: SQLiteDatabase,
  row: SyncDeltaCanyonRow,
  dirtyFieldNames: string[],
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO canyons
       (id, sync_role, name, latitude, longitude, alt_names_json,
        num_abseils, longest_abseil, v_grade, a_grade, commitment, quality,
        hours, notes, attributes_json, forked_from_id, created_at, updated_at,
        extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.syncRole,
    row.name,
    row.latitude,
    row.longitude,
    JSON.stringify(row.altNames ?? []),
    row.numAbseils,
    row.longestAbseil,
    row.vGrade,
    row.aGrade,
    row.commitment,
    row.quality,
    row.hours,
    row.notes,
    JSON.stringify(row.attributes ?? {}),
    row.forkedFromId,
    row.createdAt,
    row.updatedAt,
    splitExtras(row, CANYON_KNOWN),
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
        canyons_json, created_at, updated_at, extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.date,
    row.displayName,
    JSON.stringify(row.types ?? []),
    row.notes,
    JSON.stringify(row.customFields ?? {}),
    JSON.stringify(row.canyons ?? []),
    row.createdAt,
    row.updatedAt,
    splitExtras(row, TRIP_KNOWN),
    dirtyFieldNames.length ? JSON.stringify(dirtyFieldNames) : null,
  );
}

/**
 * A trip's pending canyon-link edit, rebased onto a fresh server row.
 *
 * The push op carries `canyonIds: string[]` while the delta row carries
 * `canyons: {id,name}[]`, so the generic rebase — which merges op fields over
 * row fields BY NAME — never overrode the link list: the server's value won
 * and `canyonIds` fell through into `extra_json` as junk. Re-link a trip
 * offline and the next pull visibly snapped it back.
 *
 * The local mirror column already holds the edit complete with names (that is
 * what `updateTripLocal` wrote), so the rebase keeps the local column rather
 * than trying to resolve id→name here.
 */
export async function rebasePendingCanyonLinks(
  db: SQLiteDatabase,
  row: SyncDeltaTripRow,
  dirtyNames: string[],
): Promise<{ effective: SyncDeltaTripRow; dirtyNames: string[] }> {
  if (!dirtyNames.includes("canyonIds")) return { effective: row, dirtyNames };
  const local = await db.getFirstAsync<{ canyons_json: string | null }>(
    "SELECT canyons_json FROM trip_logs WHERE id = ?",
    row.id,
  );
  const { canyonIds: _discard, ...rest } = row as SyncDeltaTripRow & {
    canyonIds?: unknown;
  };
  return {
    effective: {
      ...rest,
      canyons: local?.canyons_json
        ? (JSON.parse(local.canyons_json) as SyncDeltaTripRow["canyons"])
        : row.canyons,
    },
    dirtyNames: dirtyNames.map((name) => (name === "canyonIds" ? "canyons" : name)),
  };
}

export async function upsertWaypoint(
  db: SQLiteDatabase,
  row: SyncDeltaWaypointRow,
  dirtyFieldNames: string[],
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO waypoints
       (id, owner_id, canyon_ids_json, tags_json, sync_role, name, latitude,
        longitude, elevation, symbol, notes, created_at, updated_at,
        extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.ownerId,
    JSON.stringify(row.canyonIds ?? []),
    JSON.stringify(row.tags ?? []),
    row.syncRole,
    row.name,
    row.latitude,
    row.longitude,
    row.elevation,
    row.symbol,
    row.notes,
    row.createdAt,
    row.updatedAt,
    splitExtras(row, WAYPOINT_KNOWN),
    dirtyFieldNames.length ? JSON.stringify(dirtyFieldNames) : null,
  );
}

export async function upsertRoute(
  db: SQLiteDatabase,
  row: SyncDeltaRouteRow,
  dirtyFieldNames: string[],
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO routes
       (id, owner_id, canyon_id, name, color, points_json, anchors_json,
        sync_role, created_at, updated_at, extra_json, dirty_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.ownerId,
    row.canyonId,
    row.name,
    row.color,
    JSON.stringify(row.points),
    row.anchors == null ? null : JSON.stringify(row.anchors),
    row.syncRole,
    row.createdAt,
    row.updatedAt,
    splitExtras(row, ROUTE_KNOWN),
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
       filename = ?, file_size_bytes = ?, color = ?, created_at = ?,
       extra_json = ?, sync_state = 'synced'
     WHERE id = ?`,
    row.linkedType,
    row.linkedId,
    row.mediaType,
    row.filename,
    row.fileSizeBytes,
    row.color,
    row.createdAt,
    splitExtras(row, MEDIA_KNOWN),
    row.id,
  );
  if (updated.changes === 0) {
    await db.runAsync(
      `INSERT INTO media
         (id, linked_type, linked_id, media_type, filename, file_size_bytes,
          color, created_at, extra_json, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
      row.id,
      row.linkedType,
      row.linkedId,
      row.mediaType,
      row.filename,
      row.fileSizeBytes,
      row.color,
      row.createdAt,
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
    `INSERT OR REPLACE INTO canyon_shares
       (id, canyon_id, direction, counterpart_user_id, counterpart_username,
        created_at, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    row.id,
    row.canyonId,
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

// ── canyon link cascade ──────────────────────────────────────────────────────

/**
 * Take a dead canyon out of the mirror's JSON link columns.
 *
 * Waypoints have linked to canyons MANY-TO-MANY since the m2m change; the
 * cascade here used to null a `waypoints.canyon_id` column that no longer
 * exists on any fresh install, which threw inside the delta transaction, took
 * the cursor write down with the rollback, and froze the whole pull loop on
 * the first canyon delete the account ever saw. Trips carry the link with its
 * name (the derived title is built offline), so they need the same scrub in
 * their own shape.
 *
 * Both the server tombstone and the local delete route through here — the two
 * used to differ, which is how waypoints kept dead links while trips didn't.
 */
export async function scrubCanyonLinks(
  db: SQLiteDatabase,
  canyonId: string,
): Promise<void> {
  // LIKE narrows the rewrite to candidate rows (it matches substrings too, so
  // the helpers decide); the alternative is parsing every waypoint on the phone.
  const waypoints = await db.getAllAsync<{ id: string; canyon_ids_json: string | null }>(
    "SELECT id, canyon_ids_json FROM waypoints WHERE canyon_ids_json LIKE ?",
    `%${canyonId}%`,
  );
  for (const waypoint of waypoints) {
    const next = withoutCanyonId(waypoint.canyon_ids_json, canyonId);
    if (next === null) continue;
    await db.runAsync(
      "UPDATE waypoints SET canyon_ids_json = ? WHERE id = ?",
      next,
      waypoint.id,
    );
  }

  const trips = await db.getAllAsync<{ id: string; canyons_json: string | null }>(
    "SELECT id, canyons_json FROM trip_logs WHERE canyons_json LIKE ?",
    `%${canyonId}%`,
  );
  for (const trip of trips) {
    const next = withoutCanyonLink(trip.canyons_json, canyonId);
    if (next === null) continue;
    await db.runAsync(
      "UPDATE trip_logs SET canyons_json = ? WHERE id = ?",
      next,
      trip.id,
    );
  }
}

// ── tombstone apply (§9 local cascade) ───────────────────────────────────────
//
// Returns local file paths of cached media blobs the caller must delete
// AFTER the transaction commits (filesystem I/O doesn't belong inside it).

export async function applyTombstone(
  db: SQLiteDatabase,
  tombstone: SyncDeltaTombstone,
): Promise<string[]> {
  const orphanedPaths: string[] = [];

  const collectMediaPaths = async (where: string, ...args: string[]) => {
    const rows = await db.getAllAsync<{
      local_display_path: string | null;
      local_thumb_path: string | null;
    }>(
      `SELECT local_display_path, local_thumb_path FROM media WHERE ${where}`,
      ...args,
    );
    for (const row of rows) {
      if (row.local_display_path) orphanedPaths.push(row.local_display_path);
      if (row.local_thumb_path) orphanedPaths.push(row.local_thumb_path);
    }
  };

  switch (tombstone.type) {
    case "canyon": {
      // Belt and braces both ends: the server fans out media tombstones too,
      // but the local cascade must not depend on their delivery order.
      await collectMediaPaths(
        "linked_type = 'canyon' AND linked_id = ?",
        tombstone.id,
      );
      await db.runAsync(
        "DELETE FROM media WHERE linked_type = 'canyon' AND linked_id = ?",
        tombstone.id,
      );
      await db.runAsync("DELETE FROM canyons WHERE id = ?", tombstone.id);
      await db.runAsync("DELETE FROM canyon_shares WHERE canyon_id = ?", tombstone.id);
      // Route canyon links are SetNull server-side; mirror matches.
      await db.runAsync(
        "UPDATE routes SET canyon_id = NULL WHERE canyon_id = ?",
        tombstone.id,
      );
      await scrubCanyonLinks(db, tombstone.id);
      break;
    }
    case "tripLog": {
      await collectMediaPaths(
        "linked_type = 'tripLog' AND linked_id = ?",
        tombstone.id,
      );
      await db.runAsync(
        "DELETE FROM media WHERE linked_type = 'tripLog' AND linked_id = ?",
        tombstone.id,
      );
      await db.runAsync("DELETE FROM trip_logs WHERE id = ?", tombstone.id);
      break;
    }
    case "media": {
      await collectMediaPaths("id = ?", tombstone.id);
      await db.runAsync("DELETE FROM media WHERE id = ?", tombstone.id);
      break;
    }
    case "canyonShare":
      await db.runAsync("DELETE FROM canyon_shares WHERE id = ?", tombstone.id);
      break;
    case "friendship":
      await db.runAsync("DELETE FROM friendships WHERE id = ?", tombstone.id);
      break;
    case "waypoint":
      await db.runAsync("DELETE FROM waypoints WHERE id = ?", tombstone.id);
      break;
    case "route":
      // Also the signal for "unlinked from a canyon you can see" — the route
      // still exists for its owner, but this user must forget it.
      await db.runAsync("DELETE FROM routes WHERE id = ?", tombstone.id);
      break;
  }

  // Pending local ops on a server-deleted row: delete wins (§6); park them
  // deadRemote so the parked-ops UI can offer "recreate from local copy".
  //
  // A pending local DELETE is the exception — it wanted exactly what just
  // happened. Parking it raised a permanent "needs your attention" issue for
  // work already done (delete the canyon on the phone offline, delete it on
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

type CanyonRow = {
  id: string;
  sync_role: string;
  name: string;
  latitude: number;
  longitude: number;
  alt_names_json: string | null;
  num_abseils: number | null;
  longest_abseil: number | null;
  v_grade: number | null;
  a_grade: number | null;
  commitment: number | null;
  quality: number | null;
  hours: number | null;
  notes: string | null;
  attributes_json: string | null;
  created_at: string | null;
  updated_at: string | null;
  extra_json: string | null;
};

export type MirrorCanyon = TCanyon & { syncRole: "owner" | "shared" };

function parseJson<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToCanyon(row: CanyonRow): MirrorCanyon {
  const extras = parseJson<Record<string, unknown>>(row.extra_json, {});
  return {
    // Extras first — typed columns are authoritative for known fields.
    ...(extras as Partial<TCanyon>),
    id: row.id,
    ownerId: (extras.ownerId as string) ?? "",
    syncRole: row.sync_role === "owner" ? "owner" : "shared",
    name: row.name,
    altNames: parseJson<string[]>(row.alt_names_json, []),
    latitude: row.latitude,
    longitude: row.longitude,
    numAbseils: row.num_abseils,
    longestAbseil: row.longest_abseil,
    vGrade: row.v_grade,
    aGrade: row.a_grade,
    commitment: row.commitment,
    quality: row.quality,
    hours: row.hours,
    notes: row.notes,
    attributes: parseJson(row.attributes_json, {}),
    ropeWikiId: (extras.ropeWikiId as number | null) ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export async function listMirrorCanyons(): Promise<MirrorCanyon[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<CanyonRow>(
    "SELECT * FROM canyons ORDER BY name COLLATE NOCASE ASC",
  );
  return rows.map(rowToCanyon);
}

export async function getMirrorCanyon(id: string): Promise<MirrorCanyon | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<CanyonRow>(
    "SELECT * FROM canyons WHERE id = ?",
    id,
  );
  return row ? rowToCanyon(row) : null;
}

type TripRow = {
  id: string;
  date: string;
  display_name: string | null;
  types_json: string | null;
  notes: string | null;
  custom_fields_json: string | null;
  canyons_json: string;
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
    canyons: parseJson<{ id: string; name: string }[]>(row.canyons_json, []),
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
  linkedId: string;
  mediaType: string;
  filename: string | null;
  color: string | null;
  createdAt: string;
  syncState: string;
  localThumbPath: string | null;
  localDisplayPath: string | null;
};

/**
 * Attachment tally per linked row, for a list that wants to show "this entry
 * has photos" without loading every media row. One grouped read rather than a
 * query per visible row.
 */
/**
 * How many people each of the viewer's own canyons is shared WITH, keyed by
 * canyon id. Derived from the mirrored `canyon_shares` rows so the "Shared with
 * N" badge works offline — the server's `_count.shares` never reaches the
 * mirror.
 *
 * Outgoing only: an incoming share is the row that made a canyon visible to
 * the viewer, not evidence of their own fan-out. Canyons with no share have no
 * key, which is what "not shared" reads as.
 */
export async function countOutgoingSharesByCanyon(): Promise<Record<string, number>> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{ canyon_id: string; n: number }>(
    `SELECT canyon_id, COUNT(*) AS n FROM canyon_shares
     WHERE direction = 'out'
     GROUP BY canyon_id`,
  );
  return Object.fromEntries(rows.map((row) => [row.canyon_id, row.n]));
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
  const rows = await db.getAllAsync<{
    id: string;
    linked_type: string;
    linked_id: string;
    media_type: string;
    filename: string | null;
    color: string | null;
    created_at: string | null;
    sync_state: string;
    local_thumb_path: string | null;
    local_display_path: string | null;
  }>(
    `SELECT id, linked_type, linked_id, media_type, filename, color,
            created_at, sync_state, local_thumb_path, local_display_path
     FROM media WHERE linked_type = ? AND linked_id = ?
       AND sync_state != 'pendingDelete'
     ORDER BY created_at ASC`,
    linkedType,
    linkedId,
  );
  return rows.map((row) => ({
    id: row.id,
    linkedType: row.linked_type,
    linkedId: row.linked_id,
    mediaType: row.media_type,
    filename: row.filename,
    color: row.color,
    createdAt: row.created_at ?? "",
    syncState: row.sync_state,
    localThumbPath: row.local_thumb_path,
    localDisplayPath: row.local_display_path,
  }));
}

/**
 * Every canyon route attachment (.gpx/.kml) the mirror knows about — the map's
 * "Canyon routes" layer.
 *
 * Read from the MIRROR rather than `GET /canyons/tracks` (which is what the web
 * map uses): the rows and, for anything the user has looked at, the files are
 * already on the device, so the layer draws in a canyon with no signal. It also
 * means the feature adds no new server call and no new coordinate traffic.
 */
export async function listCanyonTrackMedia(
  trackMimeTypes: readonly string[],
): Promise<MirrorMedia[]> {
  const db = await getSyncDb();
  const placeholders = trackMimeTypes.map(() => "?").join(", ");
  const rows = await db.getAllAsync<{
    id: string;
    linked_type: string;
    linked_id: string;
    media_type: string;
    filename: string | null;
    color: string | null;
    created_at: string | null;
    sync_state: string;
    local_thumb_path: string | null;
    local_display_path: string | null;
  }>(
    `SELECT id, linked_type, linked_id, media_type, filename, color,
            created_at, sync_state, local_thumb_path, local_display_path
     FROM media
     WHERE linked_type = 'canyon' AND media_type IN (${placeholders})
       AND sync_state != 'pendingDelete'
     ORDER BY created_at ASC`,
    ...trackMimeTypes,
  );
  return rows.map((row) => ({
    id: row.id,
    linkedType: row.linked_type,
    linkedId: row.linked_id,
    mediaType: row.media_type,
    filename: row.filename,
    color: row.color,
    createdAt: row.created_at ?? "",
    syncState: row.sync_state,
    localThumbPath: row.local_thumb_path,
    localDisplayPath: row.local_display_path,
  }));
}

type WaypointRow = {
  id: string;
  owner_id: string | null;
  canyon_ids_json: string | null;
  tags_json: string | null;
  sync_role: string | null;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number | null;
  symbol: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MirrorWaypoint = {
  id: string;
  ownerId: string | null;
  canyonIds: string[];
  tags: string[];
  /** 'shared' — arrived via a canyon share and is READ-ONLY on this device. */
  syncRole: "owner" | "shared";
  name: string;
  latitude: number;
  longitude: number;
  elevation: number | null;
  symbol: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

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

function rowToWaypoint(row: WaypointRow): MirrorWaypoint {
  return {
    id: row.id,
    ownerId: row.owner_id,
    canyonIds: parseStringList(row.canyon_ids_json),
    tags: parseStringList(row.tags_json),
    // Absent on rows written before shared waypoints existed, and on every
    // locally-created row — both are the user's own.
    syncRole: row.sync_role === "shared" ? "shared" : "owner",
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    elevation: row.elevation,
    symbol: row.symbol,
    notes: row.notes,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export async function listMirrorWaypoints(): Promise<MirrorWaypoint[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<WaypointRow>(
    "SELECT * FROM waypoints ORDER BY created_at DESC",
  );
  return rows.map(rowToWaypoint);
}

type RouteRow = {
  id: string;
  owner_id: string | null;
  canyon_id: string | null;
  name: string;
  color: string | null;
  points_json: string;
  anchors_json: string | null;
  sync_role: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MirrorRoute = {
  id: string;
  ownerId: string | null;
  canyonId: string | null;
  name: string;
  color: string | null;
  points: [number, number][];
  /** Indices into `points` the user placed; null means "no record". */
  anchors: number[] | null;
  /** 'shared' means this arrived through a canyon share — read-only here. */
  syncRole: string | null;
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
    canyonId: row.canyon_id,
    name: row.name,
    color: row.color,
    points,
    anchors,
    syncRole: row.sync_role,
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
