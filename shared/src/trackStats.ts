// Track recording pure core (mobile Stage 7). The recorder's native side is a
// dumb pipe: expo-location hands fixes to these functions, accepted points are
// batch-written to SQLite, and stats are recomputed from the stored series.
// Everything with a branch lives here, under vitest, device-free.
//
// PRIVACY: recorded tracks are precise user location history. These helpers
// never log, and callers must keep point data out of logs/telemetry/crash
// reports (root privacy rules).

import { haversineMeters } from "./canyonGeo.js";

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
export const MAX_ACCEPTED_ACCURACY_M = 50;

// Below this movement a fix is a duplicate, not progress. Matches the
// recorder's OS-level distanceInterval; re-applied here because resumed /
// replayed batches can re-deliver the last fix.
export const MIN_POINT_DISTANCE_M = 5;

// GPS altitude jitters ±5–10 m standing still. Elevation gain uses a
// hysteresis filter: a climb/descent only counts once it exceeds this
// threshold, so sawtooth noise sums to zero instead of hundreds of metres.
export const ELEVATION_HYSTERESIS_M = 8;

export type FixRejection =
  | "invalid"
  | "inaccurate"
  | "out-of-order"
  | "too-close";

/**
 * Gate a platform fix before persisting it. `prev` is the last ACCEPTED point
 * (null at track/segment start). Returns null to accept, else the reason.
 */
export function rejectTrackFix(
  prev: RecordedTrackPoint | null,
  fix: CandidateFix,
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
  if (fix.accuracyM != null && fix.accuracyM > MAX_ACCEPTED_ACCURACY_M) {
    return "inaccurate";
  }
  if (prev) {
    if (fix.timestampMs <= prev.timestampMs) return "out-of-order";
    const moved = haversineMeters(prev.lat, prev.lon, fix.lat, fix.lon);
    if (moved < MIN_POINT_DISTANCE_M) return "too-close";
  }
  return null;
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
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.segment !== b.segment) continue;
    distanceM += haversineMeters(a.lat, a.lon, b.lat, b.lon);
    durationMs += b.timestampMs - a.timestampMs;
  }

  // Hysteresis elevation: track the extreme reached since the last committed
  // direction change; commit gain/loss only when the swing away from that
  // extreme exceeds the threshold.
  let elevationGainM = 0;
  let elevationLossM = 0;
  let anchor: number | null = null; // altitude at last committed turn point
  let extreme: number | null = null; // furthest altitude seen since anchor
  let direction: 1 | -1 | 0 = 0;
  for (const point of points) {
    const alt = point.altitudeM;
    if (alt == null || !Number.isFinite(alt)) continue;
    if (anchor == null || extreme == null) {
      anchor = alt;
      extreme = alt;
      continue;
    }
    if (direction === 0) {
      // Undecided until the series moves a full threshold either way.
      if (alt - anchor >= ELEVATION_HYSTERESIS_M) direction = 1;
      else if (anchor - alt >= ELEVATION_HYSTERESIS_M) direction = -1;
      extreme = direction === 0 ? extreme : alt;
      continue;
    }
    if (direction === 1) {
      if (alt > extreme) extreme = alt;
      else if (extreme - alt >= ELEVATION_HYSTERESIS_M) {
        elevationGainM += extreme - anchor;
        anchor = extreme;
        extreme = alt;
        direction = -1;
      }
    } else {
      if (alt < extreme) extreme = alt;
      else if (alt - extreme >= ELEVATION_HYSTERESIS_M) {
        elevationLossM += anchor - extreme;
        anchor = extreme;
        extreme = alt;
        direction = 1;
      }
    }
  }
  // Flush the open leg.
  if (anchor != null && extreme != null) {
    if (direction === 1 && extreme > anchor) elevationGainM += extreme - anchor;
    if (direction === -1 && extreme < anchor) elevationLossM += anchor - extreme;
  }

  return {
    distanceM,
    durationMs,
    elevationGainM,
    elevationLossM,
    pointCount: points.length,
  };
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
