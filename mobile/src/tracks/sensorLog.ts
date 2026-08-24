// Developer-only raw sensor logging, tied to the life of a recording.
//
// WHAT IT IS FOR: the track-accuracy work (private/todo/track-accuracy.md)
// cannot decide between creek-snapping, dead reckoning and a cleverer filter
// without knowing how long GPS outages actually last in a canyon, how often a
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
// PRIVACY: the native side writes motion, pressure, step counts and satellite
// signal strengths — no coordinates of any kind. The file lands in
// `SENSOR_LOG_DIR`, which is app-private, backup-excluded and wiped on an
// account transition like every other local store. Nothing uploads it; getting
// it off the phone is a deliberate `adb` pull.
import * as FileSystem from "expo-file-system/legacy";

import LogjamSensors, {
  type SensorCapabilities,
  type SensorLogStatus,
} from "../../modules/logjam-sensors/src/LogjamSensorsModule";
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

/** Device-scoped, like every other recording preference. */
export function readSensorLoggingEnabled(): boolean {
  return readPref(ENABLED_KEY) === "1";
}

export function writeSensorLoggingEnabled(enabled: boolean): boolean {
  return writePref(ENABLED_KEY, enabled ? "1" : "0");
}

export function sensorCapabilities(): SensorCapabilities | null {
  try {
    return LogjamSensors.capabilities();
  } catch {
    return null;
  }
}

export function sensorLogStatus(): SensorLogStatus | null {
  try {
    return LogjamSensors.logStatus();
  } catch {
    return null;
  }
}

/**
 * Start logging for `trackId`, if the developer toggle is on.
 *
 * NEVER THROWS. A research logger that can fail a recording is worse than no
 * logger — the recording is the thing the trip cannot repeat. Returns whether
 * it started, for the settings screen to report; callers on the recording path
 * ignore it.
 */
export async function startSensorLog(trackId: string): Promise<boolean> {
  if (!readSensorLoggingEnabled()) return false;
  try {
    // Idempotent: start/resume/continue all arm the recorder, and a resume
    // inside a process that never stopped logging must not be an error.
    if (LogjamSensors.logStatus().logging) return true;
    await FileSystem.makeDirectoryAsync(SENSOR_LOG_DIR, { intermediates: true });
    // One file per track, appended: a headless task relaunch mid-trip resumes
    // into the same file rather than orphaning what was written before it.
    LogjamSensors.startLogging(
      `${SENSOR_LOG_DIR}${trackId}.csv`,
      IMU_HZ,
      BATCH_SECONDS,
    );
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
  try {
    return LogjamSensors.stopLogging();
  } catch {
    return null;
  }
}
