// Track recording pure core (mobile Stage 7). The recorder's native side is a
// dumb pipe: expo-location hands fixes to these functions, accepted points are
// batch-written to SQLite, and stats are recomputed from the stored series.
// Everything with a branch lives here, under vitest, device-free.
//
// PRIVACY: recorded tracks are precise user location history. These helpers
// never log, and callers must keep point data out of logs/telemetry/crash
// reports (root privacy rules).

import { haversineMeters } from "./canyonGeo.js";
import {
  ELEVATION_PROFILE_MAX_SAMPLES,
  elevationGainLoss,
  type ElevationProfile,
  type ElevationSample,
} from "./elevation.js";

/** A fix as delivered by the platform, before acceptance filtering. */
export type CandidateFix = {
  lon: number;
  lat: number;
  /** GPS altitude (ellipsoid-ish, noisy) — null when the fix has none. */
  altitudeM: number | null;
  /** Horizontal accuracy radius — null when the fix has none. */
  accuracyM: number | null;
  /** Fix time, epoch ms. */
  timestampMs: number;
};

/**
 * One stored track point. `segment` increments across pause/resume gaps so
 * renderers break the polyline instead of drawing a teleport line.
 *
 * The two suppression fields are the recorder's record of what it REFUSED
 * after this point: `suppressedCount` fixes arrived too close to it to be
 * progress, and the last of them landed `stationaryMs` after it. That is
 * positive evidence of standing still — see `demonstratedStoppedMs`, which is
 * the only thing that can tell a stop from slow travel once the gap between
 * accepted points is long.
 *
 * Null means NOT MEASURED, never "nothing was suppressed": rows written before
 * the recorder counted have null, and an imported series has no field at all.
 */
export type RecordedTrackPoint = CandidateFix & {
  segment: number;
  suppressedCount?: number | null;
  stationaryMs?: number | null;
};

// Fixes worse than this are discarded — a 100 m-radius fix under a canyon
// wall adds noise distance, not track. 50 m keeps degraded-but-usable fixes
// (deep canyon GPS is routinely 20–40 m) while dropping cell-tower garbage.
//
// The DEFAULT, not the rule: the recorder passes the user's own limit
// (Settings → Map → Recording), because in a slot 50 m can be the best fix
// available for half an hour and the gate turns that stretch into a gap.
export const MAX_ACCEPTED_ACCURACY_M = 50;

// Floor for the movement gate below. A fix that moved less than this is a
// duplicate, not progress, however good the fix is.
//
// It is the ONLY movement gate now. The recorder used to set a platform-level
// `distanceInterval` as well, which meant the fixes this rejects were mostly
// dropped natively and never seen — and a fix refused for being too close is
// the single best evidence that the phone was standing still. Delivery is now
// unfiltered so the refusals are counted (`RecordedTrackPoint.stationaryMs`).
export const MIN_POINT_DISTANCE_M = 5;

// Ground-speed ceiling for a plausible fix.
//
// It was 5 m/s (18 km/h) — "a scramble or a jog", sized for walking pace. That
// is the speed of the PARTY, and a recorder does not get to assume the phone is
// walking: a track recorded on the drive in, on a bus, or on a bike is above it
// continuously, and the failure is silent and self-sustaining. Measured on a
// real bus trip (2026-08-18, 30 accepted points over 23 min): every fix
// implying more than 5 m/s was rejected, which leaves `prev` pointing at the
// last accepted fix, so the NEXT fix is measured over a longer baseline and is
// rejected too — the gate only re-opens when the vehicle slows enough for the
// average since `prev` to fall under the ceiling. The recorded result was a
// series whose median gap was 27 s (max 217 s) with implied speeds pinned just
// below the ceiling at 4.84 m/s, i.e. a chorded route that under-reads distance
// and a speed profile that cannot exceed 18 km/h by construction.
//
// But it cannot simply be raised, and the repo's own noise tests are what say
// so: at 30 m accuracy a STATIONARY phone hops ~30 m between samples, which at
// 3 s is 10 m/s — so the low ceiling was quietly doing half the anti-drift job,
// and lifting it let a still phone record a kilometre it never walked.
//
// A single fix cannot tell a bus from a jittering phone by distance alone. What
// it CAN tell is whether the fix is good enough for the claim: 30 m of movement
// measured by two fixes that are themselves 30 m uncertain demonstrates
// nothing, while the same movement from a pair of 5 m fixes is real. So the
// ceiling is chosen by fix quality — the vehicle allowance is only extended to
// fixes precise enough to earn it, and a degraded fix keeps the walking-pace
// ceiling it always had.
//
// The bus trip above ran at a median accuracy of 6.3 m, so it gets the vehicle
// ceiling; the canyon-noise tests run at 30 m and keep the walking one.
export const MAX_TRACK_SPEED_MPS = 5;

/** Ceiling for a fix precise enough to demonstrate vehicle speed. 126 km/h
 *  covers any approach drive; the re-acquired fix this gate exists to reject
 *  (500 m between consecutive samples, 50 m/s) is still refused. */
export const MAX_VEHICLE_SPEED_MPS = 35;

/**
 * How precise both fixes must be before the vehicle ceiling applies.
 *
 * A fix with no reported accuracy is NOT trusted with it: unknown precision is
 * not good precision, and the walking ceiling is the safe side of that guess.
 */
export const TRUSTED_SPEED_ACCURACY_M = 10;

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
    const bothFixesPrecise =
      fix.accuracyM != null &&
      prev.accuracyM != null &&
      fix.accuracyM <= TRUSTED_SPEED_ACCURACY_M &&
      prev.accuracyM <= TRUSTED_SPEED_ACCURACY_M;
    const speedCeilingMps = bothFixesPrecise
      ? MAX_VEHICLE_SPEED_MPS
      : MAX_TRACK_SPEED_MPS;
    if (moved / dtSeconds > speedCeilingMps) return "implausible";
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
 * A point of any track series — recorded here, or read out of an imported
 * file. `RecordedTrackPoint` satisfies it; an import that carried no times
 * passes `timestampMs: null` and gets the distance/elevation half of the
 * answer, which is the half that does not need a clock.
 */
export type TrackSeriesPoint = {
  lon: number;
  lat: number;
  altitudeM: number | null;
  /** null = the source carried no time for this point. */
  timestampMs: number | null;
  segment: number;
  /** Horizontal accuracy radius, when the source knows one. */
  accuracyM?: number | null;
  /** See `RecordedTrackPoint` — absent/null on anything but a recording. */
  stationaryMs?: number | null;
};

/**
 * Below this, an interval is time spent STOPPED rather than travelling.
 *
 * Read it against the acceptance filter, not on its own: `rejectTrackFix`
 * DROPS a fix that moved less than the drift radius, so standing still does
 * not produce slow points — it produces a long gap between two accepted ones,
 * whose implied speed is tiny. That is what this classifies.
 *
 * On its own that classification is a COIN FLIP over a long interval, because
 * it can only see the interval's average. A 30 s-rate recording where someone
 * walked for 15 s of a 90 s gap averages 0.23 m/s at 5 km/h (booked: stopped,
 * all 90 s) and 0.32 m/s at 7 km/h (booked: moving, none of it) — the same
 * behaviour landing on opposite sides of a threshold. `demonstratedStoppedMs`
 * exists for that: where the recorder counted its own refusals it can say how
 * much of the interval was PROVEN stationary, and this threshold is the
 * fallback for intervals with no such evidence.
 *
 * ponytail: 0.3 m/s (1.1 km/h) is a judgement, not a measurement — slower than
 * any party that is actually walking, faster than a drift-radius hop. It is
 * the knob to turn if moving time reads long (raise it) or short (lower it)
 * against a trip you remember.
 */
export const MOVING_SPEED_THRESHOLD_MPS = 0.3;

/**
 * Time after `point` that the recorder can DEMONSTRATE was spent standing
 * still, capped at the interval it is being credited against. Null = no
 * evidence either way, so the caller falls back to the interval's average
 * speed.
 *
 * The evidence is `stationaryMs`: the recorder saw fixes keep arriving inside
 * `point`'s drift radius for that long. Staying inside a radius R for a span S
 * bounds the average speed at R/S, and only a bound BELOW the moving threshold
 * proves a stop — which is what stops this from booking slow walking as rest.
 * At the finest rate a 5 km/h walker covers 4.2 m in 3 s and is suppressed too,
 * but that suppression only spans one interval, and 5 m over 3 s bounds nothing
 * (1.7 m/s). Evidence has to accumulate for ~17 s at a 5 m radius before it
 * says anything, which is also the shortest stop this can see.
 */
function demonstratedStoppedMs(
  point: TrackSeriesPoint,
  stepMs: number,
): number | null {
  const stationaryMs = point.stationaryMs;
  if (stationaryMs == null || stationaryMs <= 0) return null;
  const radiusM = Math.max(MIN_POINT_DISTANCE_M, point.accuracyM ?? 0);
  if (radiusM / (stationaryMs / 1000) >= MOVING_SPEED_THRESHOLD_MPS) return null;
  return Math.min(stationaryMs, stepMs);
}

/**
 * Odd, centred window for the speed series — the CHART's smoothing, never the
 * stats'. Per-interval GPS speed is d/dt of two positions each carrying metres
 * of error, so the unsmoothed series is spiky enough to be unreadable.
 *
 * Moving and stopped time are classified BEFORE this window is applied, from
 * each interval's own speed: smoothing across the moment someone stops is
 * exactly what would blur the boundary being measured. Note what that speed
 * already is, though — the step between two POSITION-smoothed points
 * (DISTANCE_SMOOTHING_WINDOW), the same steps the distance total is built from,
 * so moving time and distance agree with each other by construction. It also
 * means the classification inherits that smoothing's corner-cutting: measured
 * on a real bus trip, 159 s of stopped time against 90 s if the raw positions
 * are used.
 */
export const SPEED_SMOOTHING_WINDOW = 5;

/**
 * One point on the speed series: how fast, how far into the recording.
 *
 * Against TIME, not distance — unlike the elevation profile beside it, and the
 * difference is not cosmetic. A speed series plotted against distance devotes
 * almost no width to the part of the day you stood still (no distance passes
 * while stopped) and stretches the fast sections out, which is exactly
 * backwards: the question a speed profile answers is "when was I moving", and
 * "when" is a clock. Distance-based x also collapses a rest into a single
 * column that reads as a glitch rather than a break.
 */
export type SpeedSample = { atMs: number; speedMps: number };

export type SpeedProfile = {
  samples: SpeedSample[];
  maxMps: number;
  averageMps: number;
};

/**
 * Everything derivable from a stored series, in one pass.
 *
 * Time-dependent fields are null when the series carries no timestamps — an
 * imported GPX without `<time>` has a real distance and a real climb, and no
 * honest speed. A caller must render the null as absent, never as zero.
 */
export type TrackDetail = TrackStats & {
  /** Time spent above MOVING_SPEED_THRESHOLD_MPS. */
  movingMs: number | null;
  /** Recording time that was not moving time. */
  stoppedMs: number | null;
  /** Distance over recording time — the "including stops" number. */
  averageSpeedMps: number | null;
  /** Distance over moving time — the pace actually walked. */
  movingSpeedMps: number | null;
  minAltitudeM: number | null;
  maxAltitudeM: number | null;
  /** Null when no point in the series carried an altitude. */
  elevation: ElevationProfile | null;
  /** Null when the series carries no timestamps. */
  speed: SpeedProfile | null;
};

/**
 * Thin an over-long series to `max` entries, keeping the first and the last.
 *
 * A six-hour recording is thousands of points and a chart is a few hundred
 * pixels; handing the renderer the whole series costs memory and layout for
 * detail below one pixel. Stride sampling (not averaging) because the chart
 * interpolates between whatever it is given.
 */
function decimate<T>(samples: T[], max: number): T[] {
  if (samples.length <= max || max < 2) return samples;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(samples[Math.round((i * (samples.length - 1)) / (max - 1))]!);
  }
  return out;
}

/**
 * Compute everything from the stored series (assumed already
 * acceptance-filtered and ordered by timestamp).
 *
 * Distance and duration accumulate within a segment only — the gap across a
 * pause is not walked distance and not recording time. Elevation runs across
 * the WHOLE series (a climb made while paused is still a climb the altitude
 * record shows), through a hysteresis filter so idle jitter below
 * ELEVATION_HYSTERESIS_M never accumulates.
 */
export function computeTrackDetail(
  points: readonly TrackSeriesPoint[],
): TrackDetail {
  // One missing timestamp makes the whole series untimed. A part-timed series
  // would report a duration over the timed stretch and a distance over all of
  // it, and divide one by the other to produce a speed for neither.
  const timed =
    points.length > 0 &&
    points.every(
      (point) =>
        point.timestampMs != null && Number.isFinite(point.timestampMs),
    );

  let distanceM = 0;
  let durationMs = 0;
  let movingMs = 0;
  const rawSpeeds: SpeedSample[] = [];
  // Distance along the line at each POINT, for the profiles' x axis. It shares
  // the smoothed positions the distance total is built from, so the chart's
  // last x and the headline distance are the same number.
  const distanceAt: number[] = new Array(points.length).fill(0);

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
    const segmentSpeeds: number[] = [];
    const segmentTimes: number[] = [];
    distanceAt[start] = distanceM;
    for (let i = 1; i < segment.length; i++) {
      const stepM = haversineMeters(lats[i - 1]!, lons[i - 1]!, lats[i]!, lons[i]!);
      distanceM += stepM;
      distanceAt[start + i] = distanceM;
      if (!timed) continue;
      // An imported file can carry times that go backwards or repeat; a
      // recorded series cannot (the acceptance filter rejects both). Either
      // way a non-positive step contributes no time and no speed rather than
      // a negative duration or a division by zero.
      const stepMs = segment[i]!.timestampMs! - segment[i - 1]!.timestampMs!;
      if (stepMs <= 0) continue;
      durationMs += stepMs;
      const speedMps = stepM / (stepMs / 1000);
      // Proven-stationary time first, the interval's average speed only where
      // there is nothing to prove it with.
      const stoppedStepMs = demonstratedStoppedMs(segment[i - 1]!, stepMs);
      if (stoppedStepMs != null) {
        movingMs += stepMs - stoppedStepMs;
      } else if (speedMps >= MOVING_SPEED_THRESHOLD_MPS) {
        movingMs += stepMs;
      }
      segmentSpeeds.push(speedMps);
      // Elapsed RECORDING time at the end of this interval — the running
      // durationMs, so the series' last x is the recording's own length and a
      // pause contributes no width to it.
      segmentTimes.push(durationMs);
    }
    // Smoothed per segment, so a pause gap's own long slow interval never
    // averages into the walking on either side of it.
    const smoothedSpeeds = movingMean(segmentSpeeds, SPEED_SMOOTHING_WINDOW);
    for (let i = 0; i < smoothedSpeeds.length; i++) {
      rawSpeeds.push({
        atMs: segmentTimes[i]!,
        speedMps: smoothedSpeeds[i]!,
      });
    }
    start = end;
  }

  // Hysteresis elevation. The accumulator itself is shared with DEM-derived
  // route profiles (elevation.ts) — same algorithm, different threshold: GPS
  // altitude needs a wide one to survive its random walk, a DEM surface does
  // not. The median smoothing below stays here, because it exists to fight
  // that same GPS jitter and a DEM has none to fight.
  //
  // `withAltitude` keeps each smoothed height's own point index, so the
  // profile's x axis is the distance measured AT that height rather than at
  // whatever position shares its place in a compacted array.
  const withAltitude: number[] = [];
  const rawAltitudes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const altitudeM = points[i]!.altitudeM;
    if (altitudeM == null || !Number.isFinite(altitudeM)) continue;
    withAltitude.push(i);
    rawAltitudes.push(altitudeM);
  }
  const altitudes = movingMedian(rawAltitudes, ELEVATION_SMOOTHING_WINDOW);
  const { gainM: elevationGainM, lossM: elevationLossM } = elevationGainLoss(
    altitudes,
    ELEVATION_HYSTERESIS_M,
  );

  let minAltitudeM: number | null = null;
  let maxAltitudeM: number | null = null;
  const elevationSamples: ElevationSample[] = [];
  for (let k = 0; k < altitudes.length; k++) {
    const elevationM = altitudes[k]!;
    if (minAltitudeM == null || elevationM < minAltitudeM) minAltitudeM = elevationM;
    if (maxAltitudeM == null || elevationM > maxAltitudeM) maxAltitudeM = elevationM;
    elevationSamples.push({
      distanceM: distanceAt[withAltitude[k]!]!,
      elevationM,
    });
  }

  const stoppedMs = timed ? Math.max(0, durationMs - movingMs) : null;
  const speedSamples = decimate(rawSpeeds, ELEVATION_PROFILE_MAX_SAMPLES);

  return {
    distanceM,
    durationMs,
    elevationGainM,
    elevationLossM,
    pointCount: points.length,
    movingMs: timed ? movingMs : null,
    stoppedMs,
    // Speed over a zero span is not 0 m/s, it is unknown — a track with one
    // point must not claim the party stood still.
    averageSpeedMps: timed && durationMs > 0 ? distanceM / (durationMs / 1000) : null,
    movingSpeedMps: timed && movingMs > 0 ? distanceM / (movingMs / 1000) : null,
    minAltitudeM,
    maxAltitudeM,
    elevation:
      elevationSamples.length >= 2
        ? {
            samples: decimate(elevationSamples, ELEVATION_PROFILE_MAX_SAMPLES),
            gainM: elevationGainM,
            lossM: elevationLossM,
            minM: minAltitudeM,
            maxM: maxAltitudeM,
          }
        : null,
    speed:
      speedSamples.length >= 2
        ? {
            samples: speedSamples,
            maxMps: speedSamples.reduce((max, s) => Math.max(max, s.speedMps), 0),
            // The series' own mean, which is NOT distance/duration: it weights
            // every interval equally where the headline average weights them
            // by time. The chart's own baseline, and nothing else's.
            averageMps:
              speedSamples.reduce((sum, s) => sum + s.speedMps, 0) /
              speedSamples.length,
          }
        : null,
  };
}

/**
 * The four cached columns, for the recorder's write path.
 *
 * A thin pick over `computeTrackDetail` — the stats a track ROW stores. The
 * rest of the detail is derived on demand when something wants to show it, so
 * a new stat never means a migration.
 */
export function computeTrackStats(points: readonly TrackSeriesPoint[]): TrackStats {
  const detail = computeTrackDetail(points);
  return {
    distanceM: detail.distanceM,
    durationMs: detail.durationMs,
    elevationGainM: detail.elevationGainM,
    elevationLossM: detail.elevationLossM,
    pointCount: detail.pointCount,
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

/** Human speed: km/h with one decimal. Null (no timestamps) reads as unknown. */
export function formatSpeedMps(speedMps: number | null): string {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return "—";
  return `${(speedMps * 3.6).toFixed(1)} km/h`;
}

/** Human duration: "47 min", "3 h 12 min". */
export function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "—";
  const totalMinutes = Math.floor(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}
