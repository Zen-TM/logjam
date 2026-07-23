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
  rejectTrackFix,
  type CandidateFix,
  type RecordedTrackPoint,
} from "@logjam/shared";

import { randomId } from "../imports/vectorImports";
import {
  appendTrackPoints,
  deleteTrack,
  findActiveTrack,
  insertTrack,
  lastTrackPoint,
  listTrackPoints,
  updateTrack,
  type Track,
} from "./tracksDb";

export const TRACK_RECORDING_TASK = "logjam-track-recording";

// Battery posture from the plan: 5 m distance filter, no high-rate polling.
// High = GPS-priority — correct for recording outdoors (Balanced is for the
// indoor locate-me dot; a recorded track wants GPS fixes, not wifi centroids).
const LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 5,
  timeInterval: 3000,
  // Let the OS batch deliveries while backgrounded instead of waking JS per fix.
  deferredUpdatesInterval: 15_000,
  showsBackgroundLocationIndicator: true,
  activityType: Location.ActivityType.Fitness,
  foregroundService: {
    notificationTitle: "Recording track",
    notificationBody: "Logjam is recording. Open the app to pause or finish.",
    killServiceOnDestroy: false,
  },
};

const TRACK_COLOR = "#f59e0b"; // amber — distinct from the import palette

// Serialise batch writes: deliveries can arrive faster than a write completes,
// and two interleaved handlers would both read the same lastTrackPoint.
let writeChain: Promise<void> = Promise.resolve();

async function handleLocationBatch(locations: Location.LocationObject[]) {
  const track = await findActiveTrack();
  // Fixes can trail in after pause/finish (queued deliveries) — drop them.
  if (!track || track.state !== "recording") return;

  let prev = await lastTrackPoint(track.id);
  const accepted: RecordedTrackPoint[] = [];
  for (const location of locations) {
    const fix: CandidateFix = {
      lon: location.coords.longitude,
      lat: location.coords.latitude,
      altitudeM: location.coords.altitude,
      accuracyM: location.coords.accuracy,
      timestampMs: location.timestamp,
    };
    if (rejectTrackFix(prev, fix) !== null) continue;
    const point: RecordedTrackPoint = { ...fix, segment: track.currentSegment };
    accepted.push(point);
    prev = point;
  }
  if (accepted.length === 0) return;
  await appendTrackPoints(track.id, accepted);
  // O(points) per batch — fine at canyon scale (a full day ≈ thousands).
  const stats = computeTrackStats(await listTrackPoints(track.id));
  await updateTrack(track.id, { stats });
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
    writeChain = writeChain.then(() => handleLocationBatch(data.locations));
    await writeChain;
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
    updatedAt: now.toISOString(),
  };
  await insertTrack(track);
  try {
    await Location.startLocationUpdatesAsync(TRACK_RECORDING_TASK, LOCATION_OPTIONS);
  } catch (error) {
    // No half-armed state: if the service refuses to start, drop the row.
    await deleteTrack(track.id);
    throw error;
  }
  return track;
}

export async function pauseTrackRecording(trackId: string): Promise<void> {
  await stopLocationUpdatesIfRunning();
  await updateTrack(trackId, { state: "paused" });
}

export async function resumeTrackRecording(track: Track): Promise<void> {
  // New segment ⇒ the pause gap is excluded from distance/duration and the
  // rendered line breaks instead of drawing a teleport.
  await updateTrack(track.id, {
    state: "recording",
    currentSegment: track.currentSegment + 1,
  });
  await Location.startLocationUpdatesAsync(TRACK_RECORDING_TASK, LOCATION_OPTIONS);
}

export async function finishTrackRecording(trackId: string): Promise<void> {
  await stopLocationUpdatesIfRunning();
  const stats = computeTrackStats(await listTrackPoints(trackId));
  await updateTrack(trackId, {
    state: "done",
    endedAt: new Date().toISOString(),
    stats,
  });
}

export async function discardTrackRecording(trackId: string): Promise<void> {
  await stopLocationUpdatesIfRunning();
  await deleteTrack(trackId);
}

/**
 * App-launch reconciliation. Three cases:
 *  - active row + task running: recording survived a kill — leave it alone.
 *  - active row + task NOT running (reboot, force-stop): mark it paused —
 *    an honest gap the user resumes manually, never a silently dead recorder.
 *  - task running + no active row (crash between stop and delete): stop it.
 */
export async function reconcileTrackRecordingOnLaunch(): Promise<void> {
  const active = await findActiveTrack();
  const taskRunning = await Location.hasStartedLocationUpdatesAsync(
    TRACK_RECORDING_TASK,
  );
  if (active?.state === "recording" && !taskRunning) {
    await updateTrack(active.id, { state: "paused" });
  } else if (!active && taskRunning) {
    await Location.stopLocationUpdatesAsync(TRACK_RECORDING_TASK);
  }
}
