// Track recording engine (Stage 7): expo-location background updates →
// shared acceptance filter → SQLite batches. The task callback is the only
// writer of track points; UI reads via tracksDb listeners.
//
// Background model (per plan): recording starts in the FOREGROUND with a
// visible Android foreground service (location FGS type via the expo-location
// config plugin), so ACCESS_BACKGROUND_LOCATION is never requested. Recording
// survives app kill — expo-task-manager re-launches the JS task headless and
// this module's defineTask handler keeps appending to SQLite.
//
// PRIVACY: no coordinates in the service notification, logs, or errors —
// static strings and counts only. Points land in the app-private, app-locked
// offline DB (see tracksDb.ts).
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  computeTrackStats,
  recordedDurationMs,
  rejectTrackFix,
  type CandidateFix,
  type RecordedTrackPoint,
} from "@logjam/shared";

import { randomId } from "../imports/vectorImports";
import {
  FIX_RATE_OPTIONS,
  readAccuracyLimitM,
  readFixRate,
} from "./recordingPreferences";
import {
  enqueueTrackWrite,
  resetTrackWriteHealth,
} from "./trackWriteQueue";
import {
  appendTrackPoints,
  deleteTrack,
  findActiveTrack,
  getTrack,
  insertTrack,
  lastTrackPoint,
  listTrackPoints,
  updateTrack,
  type Track,
} from "./tracksDb";

export const TRACK_RECORDING_TASK = "logjam-track-recording";

// Battery posture from the plan: 5 m distance filter, no high-rate polling.
// High = GPS-priority in every preset — correct for recording outdoors
// (Balanced is for the indoor locate-me dot; a recorded track wants GPS fixes,
// not wifi centroids). What the user's "Track detail" choice moves is the RATE
// (`FIX_RATE_OPTIONS`), and it is read at start/resume rather than cached: the
// setting has to apply to the next track, and this module lives for the life of
// the process.
function locationOptions(): Location.LocationTaskOptions {
  return {
    ...FIX_RATE_OPTIONS[readFixRate()],
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.Fitness,
    foregroundService: {
      notificationTitle: "Recording track",
      notificationBody: "Logjam is recording. Open the app to pause or finish.",
      killServiceOnDestroy: false,
    },
  };
}

const TRACK_COLOR = "#f59e0b"; // amber — distinct from the import palette

// The active track's point series, held between batches so a fix does not cost
// two full-table reads (MLIFE-004: the read was O(points) per batch, quadratic
// over a recording). This module's task handler is the only writer of
// `track_point`, so the cache can only go stale by losing a write — which the
// `pointCount` check below catches, falling back to the DB.
//
// PRIVACY: this is precise location history in memory. It is dropped at every
// lifecycle transition (start/pause/resume/finish/discard/reconcile), so
// nothing outlives the recording it belongs to.
let pointCache: { trackId: string; points: RecordedTrackPoint[] } | null = null;

function dropPointCache(): void {
  pointCache = null;
}

/** The stored series, from cache when it provably matches the row's count. */
async function trackPointsForStats(track: Track): Promise<RecordedTrackPoint[]> {
  if (pointCache?.trackId === track.id && pointCache.points.length === track.pointCount) {
    return pointCache.points;
  }
  const points = await listTrackPoints(track.id);
  pointCache = { trackId: track.id, points };
  return points;
}

/**
 * Elapsed recording time from the wall clock. The point-derived duration in
 * TrackStats stops at the last accepted fix, so standing still froze the
 * on-screen clock and the Finish tap's trailing minutes never made it into the
 * saved track. `endedAtMs` is null while the recording is still live.
 */
export function trackDurationMs(track: Track, endedAtMs: number | null): number {
  return recordedDurationMs({
    startedAtMs: Date.parse(track.startedAt),
    endedAtMs,
    pausedMs: track.pausedMs,
    pausedAtMs: track.pausedAt == null ? null : Date.parse(track.pausedAt),
    nowMs: Date.now(),
  });
}

async function handleLocationBatch(locations: Location.LocationObject[]) {
  const track = await findActiveTrack();
  // Fixes can trail in after pause/finish (queued deliveries) — drop them.
  if (!track || track.state !== "recording") return;

  // The whole stored series, cached across batches; it also supplies the
  // acceptance filter's `prev` without a second query.
  const stored = await trackPointsForStats(track);
  const lastPoint = stored.length > 0 ? stored[stored.length - 1] : null;
  // A resumed segment starts fresh: measured against the PREVIOUS segment's
  // last point, every fix after a resume-in-place reads "too-close" and the
  // new segment records nothing until the user walks away from where they
  // paused.
  let prev =
    lastPoint && lastPoint.segment === track.currentSegment ? lastPoint : null;
  // Read per batch, not per fix, and not cached in a module constant: this task
  // is re-launched headless and outlives any screen, so the user's current
  // setting is whatever `prefsDb` says right now.
  const maxAccuracyM = readAccuracyLimitM();
  const accepted: RecordedTrackPoint[] = [];
  for (const location of locations) {
    const fix: CandidateFix = {
      lon: location.coords.longitude,
      lat: location.coords.latitude,
      altitudeM: location.coords.altitude,
      accuracyM: location.coords.accuracy,
      timestampMs: location.timestamp,
    };
    if (rejectTrackFix(prev, fix, maxAccuracyM) !== null) continue;
    const point: RecordedTrackPoint = { ...fix, segment: track.currentSegment };
    accepted.push(point);
    prev = point;
  }
  if (accepted.length === 0) return;
  await appendTrackPoints(track.id, accepted);
  const all = stored.concat(accepted);
  pointCache = { trackId: track.id, points: all };
  // ponytail: stats are still recomputed over the whole series per batch —
  // O(points) of pure JS, no I/O. Make it incremental (settled prefix + tail,
  // both smoothing windows carry state) only if a device profile says the
  // arithmetic itself costs; the two full-table reads were the expensive part.
  const stats = computeTrackStats(all);
  await updateTrack(track.id, {
    stats: { ...stats, durationMs: trackDurationMs(track, null) },
  });
}

// Module scope, imported from the app entry — required so the handler exists
// when Android re-launches the app headless for a queued delivery.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  TRACK_RECORDING_TASK,
  async ({ data, error }) => {
    if (error) {
      // Static code only — never location payloads.
      console.warn(`track-recording task error: ${error.code}`);
      return;
    }
    if (!data?.locations?.length) return;
    // Never rejects, and never skips the write because an earlier one failed —
    // see trackWriteQueue.ts.
    await enqueueTrackWrite(() => handleLocationBatch(data.locations));
  },
);

async function stopLocationUpdatesIfRunning(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(TRACK_RECORDING_TASK)) {
    await Location.stopLocationUpdatesAsync(TRACK_RECORDING_TASK);
  }
}

/** Caller must have foreground location permission granted already. */
export async function startTrackRecording(): Promise<Track> {
  const existing = await findActiveTrack();
  if (existing) {
    throw new Error("A track is already being recorded.");
  }
  const now = new Date();
  const track: Track = {
    id: randomId(),
    // Default label from the local date — user can rename on finish.
    name: `Track ${now.toLocaleDateString()}`,
    state: "recording",
    color: TRACK_COLOR,
    visible: true,
    currentSegment: 0,
    distanceM: 0,
    durationMs: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    pointCount: 0,
    startedAt: now.toISOString(),
    endedAt: null,
    pausedMs: 0,
    pausedAt: null,
    updatedAt: now.toISOString(),
  };
  await insertTrack(track);
  dropPointCache();
  resetTrackWriteHealth();
  try {
    await Location.startLocationUpdatesAsync(TRACK_RECORDING_TASK, locationOptions());
  } catch (error) {
    // No half-armed state: if the service refuses to start, drop the row.
    await deleteTrack(track.id);
    throw error;
  }
  return track;
}

export async function pauseTrackRecording(trackId: string): Promise<void> {
  await stopLocationUpdatesIfRunning();
  dropPointCache();
  // The pause clock starts at the TAP, not at the last fix — a user who stood
  // still for ten minutes before pausing was otherwise credited with them.
  await updateTrack(trackId, {
    state: "paused",
    pausedAt: new Date().toISOString(),
  });
}

export async function resumeTrackRecording(track: Track): Promise<void> {
  // New segment ⇒ the pause gap is excluded from distance/duration and the
  // rendered line breaks instead of drawing a teleport.
  const pausedSinceMs =
    track.pausedAt == null
      ? 0
      : Math.max(0, Date.now() - Date.parse(track.pausedAt));
  dropPointCache();
  await updateTrack(track.id, {
    state: "recording",
    currentSegment: track.currentSegment + 1,
    pausedMs: track.pausedMs + pausedSinceMs,
    pausedAt: null,
  });
  try {
    await Location.startLocationUpdatesAsync(TRACK_RECORDING_TASK, locationOptions());
  } catch (error) {
    // No half-armed state, same rule as startTrackRecording: the row was
    // already flipped to `recording` and the pause closed out, so a refused
    // start (permission revoked while paused, location services off) would
    // leave a live-looking dead recorder that nothing corrects until the next
    // cold launch. Put the pause back exactly as it was.
    await updateTrack(track.id, {
      state: "paused",
      currentSegment: track.currentSegment,
      pausedMs: track.pausedMs,
      pausedAt: track.pausedAt ?? new Date().toISOString(),
    });
    throw error;
  }
  resetTrackWriteHealth();
}

export async function finishTrackRecording(trackId: string): Promise<void> {
  await stopLocationUpdatesIfRunning();
  dropPointCache();
  const track = await getTrack(trackId);
  if (!track) throw new Error(`finishTrackRecording: no track ${trackId}`);
  const endedAt = new Date();
  const stats = computeTrackStats(await listTrackPoints(trackId));
  await updateTrack(trackId, {
    state: "done",
    endedAt: endedAt.toISOString(),
    stats: { ...stats, durationMs: trackDurationMs(track, endedAt.getTime()) },
  });
}

/**
 * Stop the recorder for a local-data wipe. The wipe deletes the `track` rows
 * out from under a live recording, and a foreground service that keeps
 * delivering fixes is a producer writing the departing user's positions after
 * the wipe reported success — the same rule the region downloader and the
 * GeoPDF import already follow. Also drops the in-memory point cache.
 */
export async function stopTrackRecordingForWipe(): Promise<void> {
  await stopLocationUpdatesIfRunning();
  dropPointCache();
}

export async function discardTrackRecording(trackId: string): Promise<void> {
  await stopLocationUpdatesIfRunning();
  dropPointCache();
  await deleteTrack(trackId);
}

/**
 * Reconciliation. Three cases:
 *  - active row + task running: recording survived a kill — leave it alone.
 *  - active row + task NOT running (reboot, force-stop): mark it paused —
 *    an honest gap the user resumes manually, never a silently dead recorder.
 *  - task running + no active row (crash between stop and delete): stop it.
 *
 * Called on mount AND on every return to the foreground: an OEM battery
 * manager, a Doze-time kill or a swiped-away notification stops the location
 * task while the JS process survives, and a mount-only check never re-runs
 * inside a process that stayed alive (MLIFE-006). It is also the backstop for
 * a recorder that died any other way.
 */
export async function reconcileTrackRecording(): Promise<void> {
  const active = await findActiveTrack();
  const taskRunning = await Location.hasStartedLocationUpdatesAsync(
    TRACK_RECORDING_TASK,
  );
  if (active?.state === "recording" && !taskRunning) {
    dropPointCache();
    // The recorder died at some unknown moment; everything from the last fix
    // to now is a gap, not recording time, so open a pause at that fix rather
    // than at launch.
    const lastPoint = await lastTrackPoint(active.id);
    await updateTrack(active.id, {
      state: "paused",
      pausedAt: new Date(
        lastPoint?.timestampMs ?? Date.parse(active.startedAt),
      ).toISOString(),
    });
  } else if (!active && taskRunning) {
    await Location.stopLocationUpdatesAsync(TRACK_RECORDING_TASK);
  }
}
