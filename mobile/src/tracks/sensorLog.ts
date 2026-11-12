// Developer-only raw sensor logging, tied to the life of a recording.
//
// WHAT IT IS FOR: the track-accuracy work cannot decide between creek-snapping, dead reckoning and a cleverer filter
// without knowing how long GPS outages actually last in a place, how often a
// party genuinely stops, and whether the barometer survives a dry bag. None of
// those are answerable from a laptop, and all of them are answerable from one
// trip's log.
//
// COLLECTED, READ BY NOTHING — deliberately, and for the third time in this
// codebase (the suppressed-fix counts, then the Doppler channel). A channel not
// recorded cannot be backfilled; a channel acted on before it is understood is
// how a filter ships wrong.
//
// DEFAULT OFF, and gated on an explicit developer toggle. It is not a feature.
//
// PRIVACY: THE FILE HOLDS POSITIONS. Beside motion, pressure, step counts and
// satellite signal strengths, the native side writes a `gps` row a second with
// the raw fix: latitude, longitude, altitude, speed and bearing. It is a second
// copy of the recording's location history and is treated as one: it lands in
// `SENSOR_LOG_DIR`, which is app-private, backup-excluded and wiped on an
// account transition like every other local store (`localStores.test.ts`), and
// it is deleted with its recording. Nothing uploads it; getting it off the
// phone is a deliberate `adb` pull. No log line or error from here or from the
// native module carries a row, a path or a coordinate.
import * as FileSystem from "expo-file-system/legacy";
import { Pedometer } from "expo-sensors";

import LogjamSensors, {
  type SensorCapabilities,
  type SensorLogStatus,
} from "../../modules/logjam-sensors/src/LogjamSensorsModule";
import { hasSpaceFor } from "../offline/freeSpace";
import { SENSOR_LOG_DIR } from "../offline/localStores";
import { readPref, writePref } from "../prefsDb";

const ENABLED_KEY = "devSensorLogging";

/**
 * IMU rate. 100 Hz is above what a stride needs (~2 Hz) by the margin an
 * offline strapdown solution wants — the point of the log is that the analysis
 * can decimate afterwards, and cannot un-decimate.
 */
const IMU_HZ = 100;

/**
 * How long the hardware FIFO may hold samples before waking the CPU.
 *
 * THE ONE NUMBER THAT DECIDES THE BATTERY COST. A Pixel 9's accel and gyro each
 * hold 3000 events, which at 100 Hz is 30 s — so this sits at the depth the
 * hardware actually has rather than above it, where the buffer would overflow
 * and drop samples, or below it, where wakeups are bought for nothing.
 */
const BATCH_SECONDS = 30;

/**
 * Measured on a Pixel 9: 8.4 kB/s at `IMU_HZ`, i.e. ~30 MB an hour,
 * with four decimals and decimated barometer readings. This figure is from a
 * real log, not from arithmetic.
 *
 * It is exported because the settings row states it: a research toggle whose
 * disk cost is a surprise is a toggle that fills someone's phone in a place.
 */
export const SENSOR_LOG_MB_PER_HOUR = 30;

/**
 * Refuse to start without room for a long day. A place trip is the one
 * recording that cannot be repeated, and a logger that fills the phone takes
 * the TRACK down with it — the offline DB and the log share a filesystem.
 * Logjam GPS's rule is that nothing large is written without asking whether it
 * fits (`offline/freeSpace.ts`, mobile/AGENTS.md); this is that check.
 */
const REQUIRED_FREE_BYTES = 14 * SENSOR_LOG_MB_PER_HOUR * 1_000_000;

/** Device-scoped, like every other recording preference. */
export function readSensorLoggingEnabled(): boolean {
  return readPref(ENABLED_KEY) === "1";
}

export function writeSensorLoggingEnabled(enabled: boolean): boolean {
  return writePref(ENABLED_KEY, enabled ? "1" : "0");
}

/**
 * Ask for `ACTIVITY_RECOGNITION`, which the step counter needs at RUNTIME on
 * Android 10+ and which a manifest entry alone does not grant.
 *
 * Borrowed from `expo-sensors`' Pedometer, whose `requestPermissionsAsync` asks
 * for exactly this permission (`PedometerModule.kt`) — reusing it is a prompt we
 * do not have to write native code for. The Pedometer ITSELF is unusable here
 * (it stops at background, and its Android `getStepCountAsync` throws), but its
 * permission request is the same permission.
 *
 * Never throws, and a refusal is not fatal: every other channel still logs, the
 * step column is simply absent. Without this the counter is silently empty and
 * looks exactly like a phone that never moved.
 */
export async function ensureStepPermission(): Promise<boolean> {
  try {
    const { granted } = await Pedometer.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/**
 * True only in a build that actually carries the native module. A user build
 * excludes it at autolinking time, so this is false and every surface below
 * (including the settings row) simply is not there.
 */
export function sensorLoggingAvailable(): boolean {
  return LogjamSensors != null;
}

export function sensorCapabilities(): SensorCapabilities | null {
  try {
    return LogjamSensors?.capabilities() ?? null;
  } catch {
    return null;
  }
}

export function sensorLogStatus(): SensorLogStatus | null {
  try {
    return LogjamSensors?.logStatus() ?? null;
  } catch {
    return null;
  }
}

// Whether a log is running, for the one piece of UI that exists only while it
// is (the mark button). Asked of the native side once, because a status read
// flushes the file, then kept in step by start and stop.
let running: boolean | null = null;
const runningListeners = new Set<() => void>();

function setRunning(next: boolean): void {
  if (running === next) return;
  running = next;
  for (const listener of runningListeners) listener();
}

/** False in a build without the native module, whatever else is true. */
export function sensorLogRunning(): boolean {
  if (LogjamSensors == null) return false;
  running ??= sensorLogStatus()?.logging ?? false;
  return running;
}

/** Subscribe to `sensorLogRunning` (useSyncExternalStore shape). */
export function onSensorLogRunningChanged(listener: () => void): () => void {
  runningListeners.add(listener);
  return () => {
    runningListeners.delete(listener);
  };
}

/**
 * What a stop leaves behind, so a start cannot undo it.
 *
 * Every disarm of the recorder stops the logger FIRST and marks the track row
 * paused or finished LAST, after reading the whole series. A fix batch
 * delivered in between still finds a recording row and asks for its log back,
 * and nothing after that ever stopped it: a finished recording kept logging
 * until the process died. So `stopped` refuses the per-batch re-arm from a
 * stop until the next deliberate start, and `stops` lets a start that was
 * still awaiting the disk notice that it has been overtaken.
 * `sensorLog.test.ts`, "a stopped recording leaves no logger running".
 *
 * Module state, so a headless relaunch starts with neither set, which is what
 * lets it resume.
 */
let stopped = false;
let stops = 0;

function logUri(trackId: string): string {
  return `${SENSOR_LOG_DIR}${trackId}.csv`;
}

/**
 * Start logging for `trackId`, if the developer toggle is on.
 *
 * `resumeOnly` starts it ONLY when this track already has a log file, which is
 * what separates the two callers. A recording start means "begin a log"; the
 * per-batch call means "a headless relaunch may have lost the registration,
 * put it back" — and those must not be the same thing, or flipping the toggle
 * during a recording would begin a file whose first half is missing, which
 * nothing downstream could distinguish from a phone that stopped sampling.
 *
 * NEVER THROWS. A research logger that can fail a recording is worse than no
 * logger — the recording is the thing the trip cannot repeat. Returns whether
 * it started, for the settings screen to report; callers on the recording path
 * ignore it.
 */
export async function startSensorLog(
  trackId: string,
  resumeOnly = false,
): Promise<boolean> {
  if (LogjamSensors == null) return false;
  if (!readSensorLoggingEnabled()) return false;
  if (resumeOnly && stopped) return false;
  if (!resumeOnly) stopped = false;
  const stopsAtEntry = stops;
  try {
    // Idempotent: start/resume/continue all arm the recorder, and a resume
    // inside a process that never stopped logging must not be an error.
    const status = LogjamSensors.logStatus();
    if (status.logging) {
      if (status.path.endsWith(`/${trackId}.csv`)) {
        setRunning(true);
        return true;
      }
      // Another track's log, which only a missed stop leaves behind: joining
      // it would append this recording to that file.
      LogjamSensors.stopLogging();
    }
    if (resumeOnly) {
      const existing = await FileSystem.getInfoAsync(logUri(trackId));
      if (!existing.exists) return false;
    }
    if (!(await hasSpaceFor(REQUIRED_FREE_BYTES))) {
      // Counts only, no path (PRIVACY). Not an exception: a full disk must
      // cost the research log, never the recording.
      console.warn("sensor-log: not enough free space, logging skipped");
      return false;
    }
    await FileSystem.makeDirectoryAsync(SENSOR_LOG_DIR, {
      intermediates: true,
    });
    // One file per track, appended: a headless task relaunch mid-trip resumes
    // into the same file rather than orphaning what was written before it. The
    // native side writes a fresh wall-clock anchor row on every open, so each
    // resumed span carries its own clock alignment.
    if (stops !== stopsAtEntry) return false;
    LogjamSensors.startLogging(logUri(trackId), IMU_HZ, BATCH_SECONDS);
    setRunning(true);
    return true;
  } catch (error) {
    // Static code only — never a path or a sample (PRIVACY).
    console.warn(
      `sensor-log: start refused (${error instanceof Error ? error.name : "unknown"})`,
    );
    return false;
  }
}

/** Stop and flush. Safe when nothing was logging; never throws. */
export function stopSensorLog(): SensorLogStatus | null {
  stopped = true;
  stops += 1;
  if (LogjamSensors != null) setRunning(false);
  try {
    return LogjamSensors?.stopLogging() ?? null;
  } catch {
    return null;
  }
}

const MARKS_KEY = "devSensorLogMarks";

/** Marks written so far in `trackId`'s log. Kept in prefs, as `<id>:<n>`, so
 *  the count carries on after a process death in the middle of a trip. */
export function sensorLogMarkCount(trackId: string): number {
  const [id, n] = (readPref(MARKS_KEY) ?? "").split(":");
  return id === trackId ? Number(n) || 0 : 0;
}

/**
 * Write the next `mark` row into the running log: "stopped here", "moving
 * again". Returns its number, or null when no row was written (no native
 * module, no log running). Never throws.
 */
export function markSensorLog(trackId: string): number | null {
  if (LogjamSensors == null) return null;
  try {
    const n = sensorLogMarkCount(trackId) + 1;
    if (!LogjamSensors.mark(n)) return null;
    writePref(MARKS_KEY, `${trackId}:${n}`);
    return n;
  } catch {
    return null;
  }
}

/**
 * Delete a recording's log with the recording. The file holds its positions,
 * so "every point is deleted" has to include it; a discarded recording used to
 * leave its log behind for a track that no longer existed. Never throws.
 */
export async function deleteSensorLog(trackId: string): Promise<void> {
  if (LogjamSensors == null) return;
  try {
    await FileSystem.deleteAsync(logUri(trackId), { idempotent: true });
  } catch {
    // Static string only (PRIVACY). The account-transition wipe still takes it.
    console.warn("sensor-log: could not delete a log");
  }
}
