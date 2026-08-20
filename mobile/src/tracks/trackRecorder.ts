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
// A BACKGROUNDED RECORDER DOES ONE THING: append the accepted fixes. The
// derived stats (distance, ascent, duration) are display-only, so they are
// recomputed when the app is in front of someone — per batch while it is, and
// once on return to the foreground — never in the headless task. See
// `refreshTrackStats`.
//
// PRIVACY: no coordinates in the service notification, logs, or errors —
// static strings and counts only. Points land in the app-private, app-locked
// offline DB (see tracksDb.ts), and no copy of the series is held in memory.
import { AppState } from "react-native";
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
  addTrackPointSuppression,
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

/**
 * Push the current recording preferences at a recorder that is ALREADY running.
 * Returns false when nothing was recording, which is not an error.
 *
 * Changing "Track detail" mid-trip used to do nothing at all — the preference
 * was written and `locationOptions()` was only ever read at start/resume — so a
 * user who dropped to the finest rate for one tricky navigation got the coarse
 * rate anyway, and the setting silently lied for the rest of the recording.
 *
 * Re-registering the SAME task is the whole mechanism, and it is not a
 * stop/start: expo-task-manager's `registerTask` recognises the existing task
 * and updates its options in place (TaskService.java), which reaches
 * `LocationTaskConsumer.setOptions` — that stops and re-requests the platform's
 * location updates itself. So there is no window with no recorder in it, and no
 * way to end up with a live-looking row and a dead service, which is exactly
 * what a stop-then-start here could leave behind if the start refused.
 */
export async function applyRecordingOptionsToActiveTrack(): Promise<boolean> {
  if (!(await Location.hasStartedLocationUpdatesAsync(TRACK_RECORDING_TASK))) {
    return false;
  }
  await Location.startLocationUpdatesAsync(TRACK_RECORDING_TASK, locationOptions());
  return true;
}

const TRACK_COLOR = "#f59e0b"; // amber — distinct from the import palette

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

/**
 * Recompute a track's cached stats (distance, gain, loss, duration, count) from
 * its stored points.
 *
 * SEPARATE FROM RECORDING ON PURPOSE. These numbers exist to be displayed —
 * nothing in the app acts on them — so they are computed when something can
 * display them, not on the arrival of every batch. Recomputing per batch meant
 * a full read of the series plus O(points) of arithmetic for every fix, all
 * night, in a headless task nobody was looking at, and it got more expensive
 * the longer the trip ran.
 *
 * ponytail: still a full recompute rather than an incremental one. That is
 * cheap now that it runs only while the app is open (and at the shipped 30 s
 * fix rate); make it incremental if a device profile says otherwise.
 */
async function refreshTrackStats(trackId: string): Promise<void> {
  const track = await getTrack(trackId);
  if (!track) return;
  const stats = computeTrackStats(await listTrackPoints(trackId));
  await updateTrack(trackId, {
    // `endedAt`, not null, so this is safe to call on a finished track: with a
    // null the duration would be recomputed from the wall clock and a track
    // saved yesterday would report a day long.
    stats: {
      ...stats,
      durationMs: trackDurationMs(
        track,
        track.endedAt == null ? null : Date.parse(track.endedAt),
      ),
    },
  });
}

/** The live recording's stats, brought up to date. Called on every return to
 *  the foreground, which is where the batches that skipped the computation are
 *  paid for — once, rather than one at a time. Paused counts too: a recording
 *  paused while the app was away holds points nothing has added up yet. */
export async function refreshActiveTrackStats(): Promise<void> {
  const active = await findActiveTrack();
  if (active) await refreshTrackStats(active.id);
}

async function handleLocationBatch(locations: Location.LocationObject[]) {
  const track = await findActiveTrack();
  // Fixes can trail in after pause/finish (queued deliveries) — drop them.
  if (!track || track.state !== "recording") return;

  // Only the LAST stored point, not the series: it is all the acceptance filter
  // needs for `prev`, and it is one indexed row rather than a read that grows
  // with the recording (MLIFE-004 — the in-memory series that used to stand in
  // for this is gone, and with it a copy of the user's location history that
  // lived in the process for the whole trip).
  const lastPoint = await lastTrackPoint(track.id);
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

  // A fix refused for being too close to the last one is not noise to be
  // dropped — it is the recorder watching someone stand still, and it is the
  // only evidence that separates a stop from slow travel once the gap between
  // accepted points is long (shared/trackStats.ts, `demonstratedStoppedMs`).
  // The platform used to swallow these natively via `distanceInterval`; it no
  // longer does, so they are counted here.
  //
  // The count belongs to the point they were measured AGAINST, which is very
  // often already in the database — a whole delivery can be nothing but
  // refusals, and waiting for a point that may never come would lose it.
  let pendingCount = 0;
  let pendingUntilMs = 0;
  let storedCount = 0;
  let storedStationaryMs = 0;
  const creditSuppression = () => {
    if (pendingCount === 0 || prev == null) return;
    const stationaryMs = Math.max(0, pendingUntilMs - prev.timestampMs);
    if (accepted.length > 0) {
      // `prev` is the tail of this batch — still unwritten, so set it directly.
      const target = accepted[accepted.length - 1]!;
      target.suppressedCount = (target.suppressedCount ?? 0) + pendingCount;
      target.stationaryMs = Math.max(target.stationaryMs ?? 0, stationaryMs);
    } else {
      storedCount += pendingCount;
      storedStationaryMs = Math.max(storedStationaryMs, stationaryMs);
    }
    pendingCount = 0;
    pendingUntilMs = 0;
  };

  for (const location of locations) {
    const fix: CandidateFix = {
      lon: location.coords.longitude,
      lat: location.coords.latitude,
      altitudeM: location.coords.altitude,
      accuracyM: location.coords.accuracy,
      timestampMs: location.timestamp,
    };
    const rejection = rejectTrackFix(prev, fix, maxAccuracyM);
    if (rejection === "too-close") {
      pendingCount += 1;
      pendingUntilMs = Math.max(pendingUntilMs, fix.timestampMs);
      continue;
    }
    if (rejection !== null) continue;
    // Before `prev` moves: the refusals so far were measured against the point
    // it still points at.
    creditSuppression();
    const point: RecordedTrackPoint = { ...fix, segment: track.currentSegment };
    accepted.push(point);
    prev = point;
  }
  creditSuppression();

  if (storedCount > 0) {
    await addTrackPointSuppression(track.id, storedCount, storedStationaryMs);
  }
  // The whole job of a backgrounded recorder: write the points. The append
  // carries `pointCount` with it, so the row stays truthful about what is
  // stored even though nothing recomputes the stats until someone looks.
  if (accepted.length > 0) await appendTrackPoints(track.id, accepted);
  if (accepted.length === 0 && storedCount === 0) return;
  if (AppState.currentState === "active") await refreshTrackStats(track.id);
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

/**
 * Pick a FINISHED recording back up — the same track, a new segment.
 *
 * The trip that comes back to the car for a dropped rope, the party that stops
 * for two hours at the exit and walks out later, the recording someone finished
 * by accident: all of them used to mean a second track that has to be
 * remembered, exported and read alongside the first. This is `resume` for a
 * track that was ended rather than paused, and it produces exactly what a pause
 * would have: a segment break, so the line does not draw a teleport across the
 * gap, and the gap itself excluded from the duration.
 *
 * NOT folded into `resumeTrackRecording`. The two differ in where the gap
 * starts (`endedAt` rather than `pausedAt`) and in what a refused start has to
 * roll back TO — a finished track must go back to being finished, and reusing
 * resume's rollback would leave it as a live paused recording the user then has
 * to finish a second time.
 *
 * Caller must have foreground location permission granted already, exactly as
 * `startTrackRecording` requires.
 */
export async function continueTrackRecording(track: Track): Promise<void> {
  // One recorder, one track. `findActiveTrack`'s own query is the check, so
  // this cannot disagree with what the rest of the module considers active.
  const existing = await findActiveTrack();
  if (existing) throw new Error("A track is already being recorded.");
  // Time since the track was finished is NOT recording time. Measured from
  // `endedAt` (the finish tap), which is the same clock `pausedAt` runs on.
  const gapMs =
    track.endedAt == null ? 0 : Math.max(0, Date.now() - Date.parse(track.endedAt));
  await updateTrack(track.id, {
    state: "recording",
    currentSegment: track.currentSegment + 1,
    pausedMs: track.pausedMs + gapMs,
    endedAt: null,
    pausedAt: null,
  });
  try {
    await Location.startLocationUpdatesAsync(TRACK_RECORDING_TASK, locationOptions());
  } catch (error) {
    // No half-armed state, same rule as start/resume: the row is already live,
    // so a refused start (permission revoked, location services off) would
    // leave a dead recorder that nothing corrects until the next cold launch —
    // and would have quietly un-finished the user's track on the way.
    await updateTrack(track.id, {
      state: "done",
      currentSegment: track.currentSegment,
      pausedMs: track.pausedMs,
      endedAt: track.endedAt,
    });
    throw error;
  }
  resetTrackWriteHealth();
}

export async function finishTrackRecording(trackId: string): Promise<void> {
  await stopLocationUpdatesIfRunning();
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
 * GeoPDF import already follow.
 */
export async function stopTrackRecordingForWipe(): Promise<void> {
  await stopLocationUpdatesIfRunning();
}

export async function discardTrackRecording(trackId: string): Promise<void> {
  await stopLocationUpdatesIfRunning();
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
