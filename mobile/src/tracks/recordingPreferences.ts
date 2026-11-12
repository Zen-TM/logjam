// Track-recording preferences — Settings → Map → Recording.
//
// Two knobs, both of which were constants in `trackRecorder.ts` until the
// settings split. They are exposed because a place is the one place their
// defaults are wrong:
//
// - ACCURACY GATE. `rejectTrackFix` drops any fix whose reported accuracy is
//   worse than the limit. At the shipped 50 m, a slot or an undercut can produce
//   nothing better for half an hour, and the track goes blank across exactly the
//   part the user wanted recorded. Raising the limit buys a rougher line over no
//   line at all; lowering it is for open ridgeline work where a wandering fix is
//   the only thing that can spoil the distance.
// - FIX RATE. How often the platform is asked for a position. Slower is fewer
//   wakeups and a coarser line — an all-day trip's tradeoff, not a place's.
//
// What is NOT exposed, deliberately: the minimum-distance gate. It is adaptive
// (`max(5 m, this fix's accuracy, the last one's)`) precisely because a flat
// threshold booked a stationary phone's drift as kilometres walked, and a
// user-set number is a way back into that bug.
//
// DEVICE-scoped: it describes how this handset records.
//
// PRIVACY: two numbers about sampling. No positions.
import * as Location from "expo-location";

import { readPref, writePref } from "../prefsDb";

const ACCURACY_KEY = "recordingAccuracyLimit";
/**
 * V2 because the legacy names overlap the modern rates: the legacy `battery`
 * setting is 30 s (now `balanced`), whereas legacy `balanced` was 10 s. Reading
 * the old key through the new names would silently change the user's chosen
 * fix rate, so the modern scheme has its own key and the legacy key is
 * translated on read.
 */
const FIX_RATE_KEY = "recordingFixRateV2";
const LEGACY_FIX_RATE_KEY = "recordingFixRate";

/** Old name → the preset with the SAME RATE under the new names. */
const LEGACY_FIX_RATES: Record<string, FixRate> = {
  high: "finest",
  balanced: "detailed",
  battery: "balanced",
  maxSaver: "batterySaver",
};

/**
 * Metres of reported accuracy past which a fix is dropped. `0` means keep every
 * fix the platform offers — the "I would rather have a rough line than a gap"
 * end, and the only setting under which a deep slot records at all.
 */
export const ACCURACY_LIMITS = [20, 50, 100, 0] as const;
export type AccuracyLimitM = (typeof ACCURACY_LIMITS)[number];

/** The shipped default, and `shared`'s own constant. */
const DEFAULT_ACCURACY_LIMIT: AccuracyLimitM = 50;

export type FixRate = "finest" | "detailed" | "balanced" | "batterySaver";

/**
 * Platform request parameters per rate. `accuracy` stays `High` (GPS-priority)
 * in every preset: the alternatives resolve from wifi and cell towers, which in
 * a place means a fix from the nearest town or none at all. What changes is
 * how often we ask, and `timeInterval` is the only field here that moves the
 * power bill — it is what sets the GNSS duty cycle.
 *
 * `deferredUpdatesInterval` batches DELIVERY while the app is backgrounded
 * (expo-location buffers fixes natively and schedules one JS wakeup per batch);
 * it does not touch the GNSS engine. It costs exposure: the buffer is process
 * memory, and expo-location only flushes once the buffered span reaches the
 * interval — so a kill mid-buffer loses roughly that much recording. Keep it at
 * or below twice `timeInterval` for that reason, not to save power.
 *
 * `distanceInterval` is a DELIVERY filter too (FLP's minimum update distance),
 * and is **0 in every preset**. Setting a non-zero distance threshold saves no
 * power — it is ANDed with the interval, so the GNSS engine is already woken —
 * and dropping fixes natively prevents the JS side distinguishing a rest from
 * very slow walking (see `RecordedTrackPoint.stationaryMs`). The same gate still
 * runs in `rejectTrackFix`, adaptively and against the fix's own accuracy, so
 * nothing extra is STORED — the refusals are counted instead of vanishing.
 */
export const FIX_RATE_OPTIONS: Record<
  FixRate,
  Pick<
    Location.LocationTaskOptions,
    "accuracy" | "distanceInterval" | "timeInterval" | "deferredUpdatesInterval"
  >
> = {
  finest: {
    accuracy: Location.Accuracy.High,
    distanceInterval: 0,
    timeInterval: 3000,
    deferredUpdatesInterval: 15_000,
  },
  detailed: {
    accuracy: Location.Accuracy.High,
    distanceInterval: 0,
    timeInterval: 10_000,
    deferredUpdatesInterval: 30_000,
  },
  balanced: {
    accuracy: Location.Accuracy.High,
    distanceInterval: 0,
    timeInterval: 30_000,
    deferredUpdatesInterval: 60_000,
  },
  // An all-day trip's setting: two minutes between fixes is the longest gap
  // that still draws a line you would recognise, and the GNSS engine sleeps
  // through nearly all of it.
  //
  // Deferred delivery is held to one interval, not scaled with it: at 240 s the
  // buffer would hold three fixes — six minutes of walking living only in
  // process memory, lost to any kill.
  batterySaver: {
    accuracy: Location.Accuracy.High,
    distanceInterval: 0,
    timeInterval: 120_000,
    deferredUpdatesInterval: 120_000,
  },
};

// Derived, not hand-kept: a rate that joins FIX_RATE_OPTIONS must be storable.
const FIX_RATES = Object.keys(FIX_RATE_OPTIONS) as readonly FixRate[];

export function readAccuracyLimitM(): AccuracyLimitM {
  const stored = Number(readPref(ACCURACY_KEY));
  return (ACCURACY_LIMITS as readonly number[]).includes(stored)
    ? (stored as AccuracyLimitM)
    : DEFAULT_ACCURACY_LIMIT;
}

/** False when the device refused to store it, so the caller can say so. */
export function writeAccuracyLimitM(limit: AccuracyLimitM): boolean {
  return writePref(ACCURACY_KEY, String(limit));
}

/**
 * Defaults to `balanced` (a fix every 30 s), not the finest rate. A recording is
 * the one thing in Logjam GPS that runs for the whole trip, and a finest-rate
 * default drains the phone drawing detail nobody asked for; a user who wants
 * the fine line can choose it, and cannot recharge a flat phone in a place.
 */
export function readFixRate(): FixRate {
  const stored = readPref(FIX_RATE_KEY);
  if (FIX_RATES.includes(stored as FixRate)) return stored as FixRate;
  // Nothing under the new key: honour a choice made under the old names, by
  // RATE rather than by name.
  const legacy = LEGACY_FIX_RATES[readPref(LEGACY_FIX_RATE_KEY) ?? ""];
  return legacy ?? "balanced";
}

export function writeFixRate(rate: FixRate): boolean {
  return writePref(FIX_RATE_KEY, rate);
}

// --- The one-time "your recordings are backed up" notice ---
//
// A recording is precise location history. Finished tracks serialise to a GPX
// standalone file that syncs with the account, which is a deliberate decision
// the user is told about ONCE rather than having it switched on silently.
//
// Device-scoped like the two knobs above, and for the same reason: it records
// that this handset has said it, not something about the account.

const BACKUP_NOTICE_KEY = "trackBackupNoticeShown";

/**
 * True until the notice has been shown once.
 *
 * A failed write (`writePref` returns false on a device with no preference
 * store) means the notice is shown again next time — annoying, and the honest
 * failure: the alternative is a "shown" flag that only exists in memory and
 * silently drops the notice on a phone that could never record having seen it.
 */
export function needsTrackBackupNotice(): boolean {
  return readPref(BACKUP_NOTICE_KEY) !== "yes";
}

export function markTrackBackupNoticeShown(): boolean {
  return writePref(BACKUP_NOTICE_KEY, "yes");
}
