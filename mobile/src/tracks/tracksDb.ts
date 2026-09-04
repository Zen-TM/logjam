// Track + waypoint storage (Stage 7): recorded GPS tracks and dropped
// waypoints, in the same app-private SQLite DB as the offline registry (one
// store, one backup-exclusion posture, one app-lock trigger).
//
// PRIVACY: a recorded track is precise user location history in a canyon —
// the most sensitive data the app holds. Rows are app-private,
// backup-excluded, arm the Stage 4 app lock, stay local until Stage 8's
// explicit sync, and never reach logs, telemetry or crash reports. Logging
// around this module is state transitions and counts only.
import type {
  CandidateFix,
  FixRejection,
  RecordedTrackPoint,
  TrackStats,
} from "@logjam/shared";

import { getOfflineDb } from "../offline/registryDb";

/** recording/paused = the single active track; done = saved. */
export type TrackState = "recording" | "paused" | "done";

export type Track = {
  id: string;
  name: string;
  state: TrackState;
  color: string;
  visible: boolean;
  /** Increments on resume so the polyline breaks across pause gaps. */
  currentSegment: number;
  /** Cached stats — recomputed while the app is in the foreground and on
   *  finish, never in the background (see trackRecorder.refreshTrackStats). */
  distanceM: number;
  durationMs: number;
  elevationGainM: number;
  elevationLossM: number;
  /** Rows in `track_point`. Written ONLY by `appendTrackPoints`. */
  pointCount: number;
  startedAt: string;
  endedAt: string | null;
  /** Time already spent paused, summed at each resume. */
  pausedMs: number;
  /** Start of the pause in progress, else null. */
  pausedAt: string | null;
  /**
   * The standalone media row this finished recording was serialised into
   * (tracks/trackBackup.ts). Null while it is still recording, when it holds no
   * points, or when the backup failed and has not been retried yet.
   *
   * It is here so the recording is shown ONCE: this table is the recorder's own
   * store and stays the source of the map line and the stats, while the media
   * row is the copy that syncs, and a surface listing both has to be able to
   * tell that they are the same trip.
   */
  mediaId: string | null;
  updatedAt: string;
};

export type Waypoint = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  createdAt: string;
  /** Marker hue, derived from the waypoint's tags by map/waypointSymbol.ts.
   *  Optional so a caller with no tag context still renders. */
  color?: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function onTracksChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notifyChanged(): void {
  for (const listener of listeners) listener();
}

type TrackRow = {
  id: string;
  name: string;
  state: string;
  color: string;
  visible: number;
  currentSegment: number;
  distanceM: number;
  durationMs: number;
  elevationGainM: number;
  elevationLossM: number;
  pointCount: number;
  startedAt: string;
  endedAt: string | null;
  pausedMs: number;
  pausedAt: string | null;
  mediaId: string | null;
  updatedAt: string;
};

function rowToTrack(row: TrackRow): Track {
  return {
    id: row.id,
    name: row.name,
    state: row.state as TrackState,
    color: row.color,
    visible: row.visible !== 0,
    currentSegment: row.currentSegment,
    distanceM: row.distanceM,
    durationMs: row.durationMs,
    elevationGainM: row.elevationGainM,
    elevationLossM: row.elevationLossM,
    pointCount: row.pointCount,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    pausedMs: row.pausedMs,
    pausedAt: row.pausedAt,
    mediaId: row.mediaId,
    updatedAt: row.updatedAt,
  };
}

export async function listTracks(): Promise<Track[]> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<TrackRow>(
    "SELECT * FROM track ORDER BY startedAt DESC",
  );
  return rows.map(rowToTrack);
}

/**
 * Finished recordings with no account copy yet — what the backup sweep picks up.
 *
 * `pointCount > 0` because an empty recording has nothing to serialise:
 * `backUpFinishedTrack` returns null for one, leaving `mediaId` null, so
 * without this filter the sweep would re-select it every cycle for ever.
 *
 * Oldest first: if several are owed, the one the user is most likely to have
 * given up on is the one that has been waiting longest.
 */
export async function listTracksNeedingBackup(): Promise<Track[]> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<TrackRow>(
    `SELECT * FROM track
     WHERE state = 'done' AND mediaId IS NULL AND pointCount > 0
     ORDER BY endedAt ASC`,
  );
  return rows.map(rowToTrack);
}

/** The single recording/paused track, if any. */
export async function findActiveTrack(): Promise<Track | null> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<TrackRow>(
    "SELECT * FROM track WHERE state IN ('recording', 'paused') LIMIT 1",
  );
  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

export async function getTrack(id: string): Promise<Track | null> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<TrackRow>(
    "SELECT * FROM track WHERE id = ? LIMIT 1",
    id,
  );
  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

export async function insertTrack(track: Track): Promise<void> {
  const db = await getOfflineDb();
  await db.runAsync(
    `INSERT INTO track
       (id, name, state, color, visible, currentSegment,
        distanceM, durationMs, elevationGainM, elevationLossM, pointCount,
        startedAt, endedAt, pausedMs, pausedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    track.id,
    track.name,
    track.state,
    track.color,
    track.visible ? 1 : 0,
    track.currentSegment,
    track.distanceM,
    track.durationMs,
    track.elevationGainM,
    track.elevationLossM,
    track.pointCount,
    track.startedAt,
    track.endedAt,
    track.pausedMs,
    track.pausedAt,
    track.updatedAt,
  );
  notifyChanged();
}

/** Partial update; always bumps updatedAt and notifies. */
export async function updateTrack(
  id: string,
  patch: Partial<
    Pick<
      Track,
      | "name"
      | "state"
      | "visible"
      | "currentSegment"
      | "endedAt"
      | "pausedMs"
      | "pausedAt"
      | "color"
      | "mediaId"
    >
  > & { stats?: TrackStats },
): Promise<void> {
  const db = await getOfflineDb();
  const sets: string[] = ["updatedAt = ?"];
  const args: (string | number | null)[] = [new Date().toISOString()];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name);
  }
  if (patch.color !== undefined) {
    sets.push("color = ?");
    args.push(patch.color);
  }
  if (patch.state !== undefined) {
    sets.push("state = ?");
    args.push(patch.state);
  }
  if (patch.visible !== undefined) {
    sets.push("visible = ?");
    args.push(patch.visible ? 1 : 0);
  }
  if (patch.currentSegment !== undefined) {
    sets.push("currentSegment = ?");
    args.push(patch.currentSegment);
  }
  if (patch.endedAt !== undefined) {
    sets.push("endedAt = ?");
    args.push(patch.endedAt);
  }
  if (patch.pausedMs !== undefined) {
    sets.push("pausedMs = ?");
    args.push(patch.pausedMs);
  }
  if (patch.pausedAt !== undefined) {
    sets.push("pausedAt = ?");
    args.push(patch.pausedAt);
  }
  if (patch.mediaId !== undefined) {
    sets.push("mediaId = ?");
    args.push(patch.mediaId);
  }
  if (patch.stats !== undefined) {
    // `pointCount` is deliberately NOT written here, even though TrackStats
    // carries one. `appendTrackPoints` owns that column and maintains it in the
    // same transaction as the insert; a stats write is a read-then-write from
    // outside the recorder's serialised queue, so an absolute value computed
    // before a batch landed would clobber the increment and leave the row
    // claiming fewer points than the table holds — which the map layer reads as
    // "the series was rewritten" and answers with a full reload.
    sets.push(
      "distanceM = ?, durationMs = ?, elevationGainM = ?, elevationLossM = ?",
    );
    args.push(
      patch.stats.distanceM,
      patch.stats.durationMs,
      patch.stats.elevationGainM,
      patch.stats.elevationLossM,
    );
  }
  await db.runAsync(`UPDATE track SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
  notifyChanged();
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await getOfflineDb();
  // MOT-003: all three or none — a crash between them used to leave orphaned
  // track_point / track_point_rejected rows (location history) with no track
  // row to ever delete them again.
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM track_point WHERE trackId = ?", id);
    await db.runAsync("DELETE FROM track_point_rejected WHERE trackId = ?", id);
    await db.runAsync("DELETE FROM track WHERE id = ?", id);
  });
  notifyChanged();
}

/**
 * A track's points, optionally only those from `fromSeq` on.
 *
 * `seq` is dense and starts at 0 (see `appendTrackPoints`), so a caller holding
 * N points asks for `fromSeq = N` to get exactly what it is missing. The map
 * layer uses that to follow a live recording without re-reading the whole
 * series on every written batch — which is O(points) of I/O per fix, and
 * quadratic over a recording, on the screen that is open for the whole trip.
 */
export async function listTrackPoints(
  trackId: string,
  fromSeq = 0,
): Promise<RecordedTrackPoint[]> {
  const db = await getOfflineDb();
  return db.getAllAsync<RecordedTrackPoint>(
    `SELECT segment, lon, lat, altitudeM, accuracyM, timestampMs,
            suppressedCount, stationaryMs, speedMps, headingDeg,
            altitudeAccuracyM
       FROM track_point WHERE trackId = ? AND seq >= ? ORDER BY seq`,
    trackId,
    fromSeq,
  );
}

/** Last accepted point — the acceptance filter's `prev` across batches. */
export async function lastTrackPoint(
  trackId: string,
): Promise<RecordedTrackPoint | null> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<RecordedTrackPoint>(
    `SELECT segment, lon, lat, altitudeM, accuracyM, timestampMs,
            suppressedCount, stationaryMs, speedMps, headingDeg,
            altitudeAccuracyM
       FROM track_point WHERE trackId = ? ORDER BY seq DESC LIMIT 1`,
    trackId,
  );
  return rows.length > 0 ? rows[0] : null;
}

/** A fix the acceptance filter refused, with the reason it gave. */
export type RejectedFix = CandidateFix & {
  reason: FixRejection;
  segment: number;
};

/**
 * Keep the fixes `rejectTrackFix` threw away.
 *
 * DIAGNOSTIC ONLY — nothing draws, measures or exports these, and no code path
 * outside this function writes them. That isolation is the point: the accepted
 * series and the filter's reference (`lastTrackPoint`) live in `track_point`
 * and cannot see this table, so a bug here cannot corrupt a recording.
 *
 * Deliberately does NOT `notifyChanged()`: no screen observes rejected fixes,
 * and a notify per batch on a path nothing reads is how the `useTracks` storm
 * (885379d) happened the first time.
 *
 * Failure is swallowed by the caller, not here — see `handleLocationBatch`.
 */
export async function appendRejectedFixes(
  trackId: string,
  fixes: RejectedFix[],
): Promise<void> {
  if (fixes.length === 0) return;
  const db = await getOfflineDb();
  await db.withTransactionAsync(async () => {
    const maxRow = await db.getFirstAsync<{ maxSeq: number | null }>(
      "SELECT MAX(seq) AS maxSeq FROM track_point_rejected WHERE trackId = ?",
      trackId,
    );
    let seq = (maxRow?.maxSeq ?? -1) + 1;
    for (const fix of fixes) {
      await db.runAsync(
        `INSERT INTO track_point_rejected
           (trackId, seq, reason, segment, lon, lat, altitudeM, accuracyM,
            timestampMs, speedMps, headingDeg, altitudeAccuracyM)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        trackId,
        seq++,
        fix.reason,
        fix.segment,
        fix.lon,
        fix.lat,
        fix.altitudeM,
        fix.accuracyM,
        fix.timestampMs,
        fix.speedMps ?? null,
        fix.headingDeg ?? null,
        fix.altitudeAccuracyM ?? null,
      );
    }
  });
}

/**
 * Append a batch in one transaction. Seq continues from the stored max.
 *
 * It carries `pointCount` and `updatedAt` with it, in the SAME transaction.
 * That used to ride on the stats write that followed every batch, and the stats
 * write is now a foreground-only job (see `refreshTrackStats`) — so without this
 * a recording made with the screen off would grow its points while the row went
 * on claiming it had none, and the map layer, which reloads on `pointCount`,
 * would never draw them.
 */
export async function appendTrackPoints(
  trackId: string,
  points: RecordedTrackPoint[],
): Promise<void> {
  if (points.length === 0) return;
  const db = await getOfflineDb();
  await db.withTransactionAsync(async () => {
    const maxRow = await db.getFirstAsync<{ maxSeq: number | null }>(
      "SELECT MAX(seq) AS maxSeq FROM track_point WHERE trackId = ?",
      trackId,
    );
    let seq = (maxRow?.maxSeq ?? -1) + 1;
    for (const p of points) {
      await db.runAsync(
        `INSERT INTO track_point
           (trackId, seq, segment, lon, lat, altitudeM, accuracyM, timestampMs,
            suppressedCount, stationaryMs, speedMps, headingDeg,
            altitudeAccuracyM)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        trackId,
        seq++,
        p.segment,
        p.lon,
        p.lat,
        p.altitudeM,
        p.accuracyM,
        p.timestampMs,
        p.suppressedCount ?? null,
        p.stationaryMs ?? null,
        p.speedMps ?? null,
        p.headingDeg ?? null,
        p.altitudeAccuracyM ?? null,
      );
    }
    await db.runAsync(
      "UPDATE track SET pointCount = pointCount + ?, updatedAt = ? WHERE id = ?",
      points.length,
      new Date().toISOString(),
      trackId,
    );
  });
  notifyChanged();
}

/**
 * Add suppression evidence to a track's LAST stored point.
 *
 * The recorder learns that someone stood still by the fixes it refuses, and a
 * whole delivery can be nothing but refusals — so the evidence has to attach
 * to the point it was measured against, which is already written, rather than
 * to a point that may never arrive.
 *
 * Accumulating, not replacing, because that same point can collect refusals
 * across several deliveries: the count sums, and the span is a MAX because it
 * is measured from that point's own timestamp and only ever grows.
 *
 * Callers must be inside the recorder's write queue — this is a read-modify-
 * write against whatever row is last, and a batch landing between the two
 * halves would move the target.
 */
export async function addTrackPointSuppression(
  trackId: string,
  suppressedCount: number,
  stationaryMs: number,
): Promise<void> {
  if (suppressedCount <= 0) return;
  const db = await getOfflineDb();
  await db.runAsync(
    `UPDATE track_point
        SET suppressedCount = COALESCE(suppressedCount, 0) + ?,
            stationaryMs    = MAX(COALESCE(stationaryMs, 0), ?)
      WHERE trackId = ?
        AND seq = (SELECT MAX(seq) FROM track_point WHERE trackId = ?)`,
    suppressedCount,
    stationaryMs,
    trackId,
    trackId,
  );
  notifyChanged();
}

// --- Waypoints ---
//
// The local-only `waypoint` table is gone (Stage 8 made waypoints a synced
// entity; `migrateLegacyWaypoints` drains and drops it). The `Waypoint` SHAPE
// survives as the map layer's contract — mirror rows are mapped into it.
