// Track recording pure core (mobile Stage 7). The recorder's native side is a
// dumb pipe: expo-location hands fixes to these functions, accepted points are
// batch-written to SQLite, and stats are recomputed from the stored series.
// Everything with a branch lives here, under vitest, device-free.
//
// PRIVACY: recorded tracks are precise user location history. These helpers
// never log, and callers must keep point data out of logs/telemetry/crash
// reports (root privacy rules).

import { haversineMeters } from "./canyonGeo.js";
import { elevationGainLoss } from "./elevation.js";

/** One stored track point. `segment` increments across pause/resume gaps so
 * renderers break the polyline instead of drawing a teleport line. */
export type RecordedTrackPoint = {
  lon: number;
  lat: number;
  /** GPS altitude (ellipsoid-ish, noisy) — null when the fix has none. */
  altitudeM: number | null;
  /** Horizontal accuracy radius — null when the fix has none. */
  accuracyM: number | null;
  /** Fix time, epoch ms. */
  timestampMs: number;
  segment: number;
};

/** A fix as delivered by the platform, before acceptance filtering. */
export type CandidateFix = Omit<RecordedTrackPoint, "segment">;

// Fixes worse than this are discarded — a 100 m-radius fix under a canyon
// wall adds noise distance, not track. 50 m keeps degraded-but-usable fixes
// (deep canyon GPS is routinely 20–40 m) while dropping cell-tower garbage.
//
// The DEFAULT, not the rule: the recorder passes the user's own limit
// (Settings → Map → Recording), because in a slot 50 m can be the best fix
// available for half an hour and the gate turns that stretch into a gap.
export const MAX_ACCEPTED_ACCURACY_M = 50;

// Floor for the movement gate below. A fix that moved less than this is a
// duplicate, not progress, however good the fix is — it matches the recorder's
// OS-level distanceInterval, re-applied here because resumed / replayed
// batches can re-deliver the last fix.
export const MIN_POINT_DISTANCE_M = 5;

// Ground-speed ceiling for a plausible fix. Canyoning tops out around 2 m/s on
// good track; 5 m/s (18 km/h) leaves headroom for a scramble or a jog while
// still rejecting the multi-hundred-metre teleport a re-acquired fix makes.
export const MAX_TRACK_SPEED_MPS = 5;

// GPS altitude jitters ±5–15 m standing still, and that jitter is a RANDOM
// WALK, not a sawtooth: any per-sample threshold leaks it, because the walk
// eventually wanders past whatever threshold you pick. So the series is
// median-smoothed first (below) and only then run through hysteresis at a
// threshold above the smoothed residual. Simulated 60 min walk with 15 m
// vertical sigma and 400 m of real climb: shipped 8 m / unsmoothed read
// 9472 m, this reads 435 m.
export const ELEVATION_HYSTERESIS_M = 15;

// Odd, centred window for the altitude median. Median (not mean) because it
// passes a monotone climb through untouched while killing spikes.
export const ELEVATION_SMOOTHING_WINDOW = 5;

// Odd, centred window for the lat/lon mean used by DISTANCE only — the stored
// points, the drawn line and the GPX export stay raw. Mean (not median)
// because position error is gaussian. 5 is the corner-cutting compromise: the
// tightest realistic switchback (15 m amplitude, 80 m wavelength) under-reads
// ~8 %, where a window of 9 under-reads ~19 %.
export const DISTANCE_SMOOTHING_WINDOW = 5;

export type FixRejection =
  | "invalid"
  | "inaccurate"
  | "out-of-order"
  | "too-close"
  | "implausible";

/**
 * Gate a platform fix before persisting it. `prev` is the last ACCEPTED point
 * (null at track/segment start — a resumed segment must pass null, or the
 * first fix after the pause is measured against wherever the user was before
 * it). Returns null to accept, else the reason.
 *
 * `maxAccuracyM` is the user's accuracy gate; `0` disables it, which is the
 * setting that lets a deep slot record at all. It does NOT disable the movement
 * or speed gates below — those are what stop a stationary phone's drift being
 * booked as distance walked, and no preference may switch them off.
 */
export function rejectTrackFix(
  prev: RecordedTrackPoint | null,
  fix: CandidateFix,
  maxAccuracyM: number = MAX_ACCEPTED_ACCURACY_M,
): FixRejection | null {
  if (
    !Number.isFinite(fix.lon) ||
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.timestampMs) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lon) > 180
  ) {
    return "invalid";
  }
  if (maxAccuracyM > 0 && fix.accuracyM != null && fix.accuracyM > maxAccuracyM) {
    return "inaccurate";
  }
  if (prev) {
    if (fix.timestampMs <= prev.timestampMs) return "out-of-order";
    const moved = haversineMeters(prev.lat, prev.lon, fix.lat, fix.lon);
    // Movement inside the fix's own error circle is drift, not travel. A
    // 30 m-accurate fix wanders 30 m while the phone sits on a rock, and a
    // flat 5 m gate books every one of those hops as distance walked — a
    // phone left still for 20 minutes recorded 10.5 km before this.
    const driftRadiusM = Math.max(
      MIN_POINT_DISTANCE_M,
      fix.accuracyM ?? 0,
      prev.accuracyM ?? 0,
    );
    if (moved < driftRadiusM) return "too-close";
    // dt > 0 is guaranteed by the out-of-order check above.
    const dtSeconds = (fix.timestampMs - prev.timestampMs) / 1000;
    if (moved / dtSeconds > MAX_TRACK_SPEED_MPS) return "implausible";
  }
  return null;
}

/**
 * Half-width of a SYMMETRIC window at `index` — it shrinks near the ends
 * rather than running off them. A one-sided window at the edges would drag
 * the first and last values inward and quietly shorten every track by up to a
 * window's worth of distance; symmetric-shrinking leaves the endpoints exactly
 * where they were measured and passes a straight ramp through untouched.
 */
function symmetricHalfWidth(index: number, length: number, window: number): number {
  return Math.min((window - 1) >> 1, index, length - 1 - index);
}

function movingMean(values: number[], window: number): number[] {
  if (window <= 1) return values.slice();
  return values.map((_, index) => {
    const half = symmetricHalfWidth(index, values.length, window);
    let sum = 0;
    for (let i = index - half; i <= index + half; i++) sum += values[i]!;
    return sum / (2 * half + 1);
  });
}

function movingMedian(values: number[], window: number): number[] {
  if (window <= 1) return values.slice();
  return values.map((_, index) => {
    const half = symmetricHalfWidth(index, values.length, window);
    const slice = values.slice(index - half, index + half + 1).sort((a, b) => a - b);
    return slice[half]!;
  });
}

export type TrackStats = {
  distanceM: number;
  /** Recording time: sum of per-segment spans — pauses excluded. */
  durationMs: number;
  elevationGainM: number;
  elevationLossM: number;
  pointCount: number;
};

/**
 * Compute stats from the stored series (assumed already acceptance-filtered
 * and ordered by timestamp). Distance and duration accumulate within a
 * segment only — the gap across a pause is not walked distance and not
 * recording time. Elevation runs across the WHOLE series (a climb made while
 * paused is still a climb the altitude record shows), through a hysteresis
 * filter so idle jitter below ELEVATION_HYSTERESIS_M never accumulates.
 */
export function computeTrackStats(points: RecordedTrackPoint[]): TrackStats {
  let distanceM = 0;
  let durationMs = 0;
  // Distance walks a position-SMOOTHED copy of each segment: summing raw
  // fix-to-fix hops integrates the error circle as travel, which over-reads a
  // 4.3 km walk as 32 km on 30 m-accurate canyon fixes. Smoothing is per
  // segment so a pause gap never averages across the two sides of it.
  for (let start = 0; start < points.length; ) {
    let end = start + 1;
    while (end < points.length && points[end]!.segment === points[start]!.segment) {
      end++;
    }
    const segment = points.slice(start, end);
    const lats = movingMean(
      segment.map((point) => point.lat),
      DISTANCE_SMOOTHING_WINDOW,
    );
    const lons = movingMean(
      segment.map((point) => point.lon),
      DISTANCE_SMOOTHING_WINDOW,
    );
    for (let i = 1; i < segment.length; i++) {
      distanceM += haversineMeters(lats[i - 1]!, lons[i - 1]!, lats[i]!, lons[i]!);
      durationMs += segment[i]!.timestampMs - segment[i - 1]!.timestampMs;
    }
    start = end;
  }

  // Hysteresis elevation. The accumulator itself is shared with DEM-derived
  // route profiles (elevation.ts) — same algorithm, different threshold: GPS
  // altitude needs a wide one to survive its random walk, a DEM surface does
  // not. The median smoothing below stays here, because it exists to fight
  // that same GPS jitter and a DEM has none to fight.
  const altitudes = movingMedian(
    points
      .map((point) => point.altitudeM)
      .filter((alt): alt is number => alt != null && Number.isFinite(alt)),
    ELEVATION_SMOOTHING_WINDOW,
  );
  const { gainM: elevationGainM, lossM: elevationLossM } = elevationGainLoss(
    altitudes,
    ELEVATION_HYSTERESIS_M,
  );

  return {
    distanceM,
    durationMs,
    elevationGainM,
    elevationLossM,
    pointCount: points.length,
  };
}

/**
 * Elapsed recording time for a LIVE or finished recording, from the wall
 * clock rather than from the fix series.
 *
 * The point-derived `durationMs` in TrackStats stops at the last accepted fix,
 * so the twenty minutes between the last fix and the Finish tap — derigging,
 * eating, waiting — vanish from the saved track, and the on-screen clock
 * freezes whenever the user stands still. Pauses are excluded by accumulating
 * them explicitly at the pause/resume taps, which is also the only way a pause
 * that began after the last fix is counted at all.
 *
 * Returns 0 rather than a negative span if the device clock is wound back
 * mid-recording.
 */
export function recordedDurationMs(input: {
  startedAtMs: number;
  /** Finish time, or null while still recording/paused. */
  endedAtMs: number | null;
  /** Total time already spent paused, summed at each resume. */
  pausedMs: number;
  /** Start of the pause currently in progress, else null. */
  pausedAtMs: number | null;
  /** Now, injected so this stays pure and testable. */
  nowMs: number;
}): number {
  const { startedAtMs, endedAtMs, pausedMs, pausedAtMs, nowMs } = input;
  const until = endedAtMs ?? nowMs;
  const openPauseMs =
    pausedAtMs == null ? 0 : Math.max(0, until - pausedAtMs);
  return Math.max(0, until - startedAtMs - pausedMs - openPauseMs);
}

/**
 * Initial great-circle bearing from (lat1,lon1) to (lat2,lon2), degrees
 * clockwise from true north in [0, 360). Navigate-to-point readout.
 */
export function initialBearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** "N", "NE", … for a bearing in degrees. */
export function compassPointFor(bearingDeg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(((bearingDeg % 360) + 360) % 360 / 45) % 8];
}

/** Human distance: metres under 1 km, else km with one decimal. */
export function formatDistanceM(distanceM: number): string {
  if (!Number.isFinite(distanceM)) return "—";
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

/** Human duration: "47 min", "3 h 12 min". */
export function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "—";
  const totalMinutes = Math.floor(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}
