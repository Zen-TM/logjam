// Elevation profiles for drawn routes and the measure tool.
//
// The pure half lives here; the DEM sampling itself is server-side
// (api/src/services/elevation.ts) so there is one implementation for web and
// mobile, one tile cache, and no DEM tile requests leaving the user's device.
//
// NOTHING HERE IS PERSISTED. Elevation is derived on demand from the point
// list plus the DEM, never stored on a Route or a point: a stored profile goes
// stale the moment a vertex moves, and would differ from a route drawn before
// the DEM existed. Route geometry stays the single source of truth.
//
// PRIVACY: a route's point list is precise wilderness location data. These
// helpers never log, and callers must keep points out of logs and error
// messages (root privacy rules).

import { haversineMeters } from "./canyonGeo.js";
import type { RoutePoint } from "./routeValidation.js";

/**
 * Upper bound on samples in one profile. Caps both the DEM work per request
 * and the width of the chart the client draws — past a few hundred points a
 * profile is drawing sub-pixel detail.
 */
export const ELEVATION_PROFILE_MAX_SAMPLES = 256;

/**
 * Target spacing between samples. Matched to the DEM's own resolution: the
 * terrarium tiles are ~30 m/px at this latitude, so sampling much tighter
 * re-reads interpolated pixels and buys nothing. Long routes hit
 * ELEVATION_PROFILE_MAX_SAMPLES first and sample more coarsely.
 */
export const ELEVATION_SAMPLE_SPACING_M = 25;

/**
 * Hysteresis threshold for DEM-derived gain/loss.
 *
 * Deliberately far below trackStats' ELEVATION_HYSTERESIS_M (15 m). That one
 * fights GPS altitude jitter — a ±15 m random walk that any smaller threshold
 * leaks. A DEM has no such jitter: it is a fixed surface, so re-reading the
 * same point gives the same answer, and the only wobble is interpolation
 * ripple between 30 m posts. Reusing 15 m here would swallow genuine
 * undulation and under-report gain on rolling terrain.
 *
 * ponytail: 5 m is a judgement, not a measurement. It is the knob to turn if
 * profiles read high (raise it) or flat (lower it) against known walks.
 */
export const DEM_ELEVATION_HYSTERESIS_M = 5;

/** One point on a profile: distance travelled, and height there. */
export type ElevationSample = {
  /** Metres along the line from its first vertex. */
  distanceM: number;
  /** Metres above sea level, or null where the DEM has no coverage. */
  elevationM: number | null;
};

export type ElevationProfile = {
  samples: ElevationSample[];
  gainM: number;
  lossM: number;
  /** Null when the DEM covered no sample at all. */
  minM: number | null;
  maxM: number | null;
};

/** A position to sample, with its distance along the line. */
export type SamplePosition = { lon: number; lat: number; distanceM: number };

/**
 * Resample a polyline to evenly spaced positions.
 *
 * Even spacing rather than the route's own vertices, because vertices are
 * where the *user clicked* — a five-vertex route across 3 km of ridge would
 * otherwise yield a five-point profile that misses every hill between them.
 * The first and last vertex are always included exactly.
 */
export function densifyLine(
  points: readonly RoutePoint[],
  maxSamples: number = ELEVATION_PROFILE_MAX_SAMPLES,
): SamplePosition[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  if (points.length === 1) {
    return [{ lon: first[0], lat: first[1], distanceM: 0 }];
  }

  // Cumulative distance at each vertex — the spine the walk below indexes into.
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cumulative.push(
      cumulative[i - 1]! + haversineMeters(a[1], a[0], b[1], b[0]),
    );
  }
  const totalM = cumulative[cumulative.length - 1]!;

  // A zero-length line (every vertex identical) has no spine to walk — one
  // sample is the honest answer, and it avoids dividing by zero below.
  if (totalM === 0) {
    return [{ lon: first[0], lat: first[1], distanceM: 0 }];
  }

  const sampleCount = Math.min(
    maxSamples,
    Math.max(2, Math.ceil(totalM / ELEVATION_SAMPLE_SPACING_M) + 1),
  );
  const step = totalM / (sampleCount - 1);

  const positions: SamplePosition[] = [];
  // `segment` only ever advances, so the walk is linear in vertices+samples
  // rather than re-scanning the spine for each sample.
  let segment = 1;
  for (let i = 0; i < sampleCount; i++) {
    const target = i === sampleCount - 1 ? totalM : i * step;
    while (segment < cumulative.length - 1 && cumulative[segment]! < target) {
      segment++;
    }
    const startM = cumulative[segment - 1]!;
    const endM = cumulative[segment]!;
    const span = endM - startM;
    // Coincident vertices give a zero-length segment; sit at its start rather
    // than producing NaN.
    const t = span === 0 ? 0 : (target - startM) / span;
    const a = points[segment - 1]!;
    const b = points[segment]!;
    positions.push({
      lon: a[0] + (b[0] - a[0]) * t,
      lat: a[1] + (b[1] - a[1]) * t,
      distanceM: target,
    });
  }
  return positions;
}

/**
 * Accumulate gain and loss through a hysteresis filter: track the extreme
 * reached since the last committed turn, and commit a leg only once the swing
 * back exceeds the threshold. Without it every wobble below the data's own
 * noise floor counts twice, once up and once down.
 *
 * Nulls (no DEM coverage) are skipped rather than treated as zero — a gap in
 * the surface is not a descent to sea level and back.
 */
export function elevationGainLoss(
  elevations: readonly (number | null)[],
  hysteresisM: number,
): { gainM: number; lossM: number } {
  let gainM = 0;
  let lossM = 0;
  let anchor: number | null = null; // height at the last committed turn
  let extreme: number | null = null; // furthest height reached since anchor
  let direction: 1 | -1 | 0 = 0;

  for (const value of elevations) {
    if (value == null || !Number.isFinite(value)) continue;
    if (anchor == null || extreme == null) {
      anchor = value;
      extreme = value;
      continue;
    }
    if (direction === 0) {
      // Undecided until the series moves a full threshold either way.
      if (value - anchor >= hysteresisM) direction = 1;
      else if (anchor - value >= hysteresisM) direction = -1;
      if (direction !== 0) extreme = value;
      continue;
    }
    if (direction === 1) {
      if (value > extreme) extreme = value;
      else if (extreme - value >= hysteresisM) {
        gainM += extreme - anchor;
        anchor = extreme;
        extreme = value;
        direction = -1;
      }
    } else {
      if (value < extreme) extreme = value;
      else if (value - extreme >= hysteresisM) {
        lossM += anchor - extreme;
        anchor = extreme;
        extreme = value;
        direction = 1;
      }
    }
  }

  // Flush the leg still open at the end of the series.
  if (anchor != null && extreme != null) {
    if (direction === 1 && extreme > anchor) gainM += extreme - anchor;
    if (direction === -1 && extreme < anchor) lossM += anchor - extreme;
  }
  return { gainM, lossM };
}

/** Assemble a profile from sample positions and the heights read for them. */
export function buildElevationProfile(
  positions: readonly SamplePosition[],
  elevations: readonly (number | null)[],
): ElevationProfile {
  if (positions.length !== elevations.length) {
    // Fail loudly: a misaligned pair would silently attribute heights to the
    // wrong distances, producing a plausible-looking but wrong profile.
    throw new Error("elevation sample count does not match position count");
  }
  const samples = positions.map((position, i) => ({
    distanceM: position.distanceM,
    elevationM: elevations[i] ?? null,
  }));
  const known = samples
    .map((s) => s.elevationM)
    .filter((value): value is number => value != null);
  const { gainM, lossM } = elevationGainLoss(
    samples.map((s) => s.elevationM),
    DEM_ELEVATION_HYSTERESIS_M,
  );
  return {
    samples,
    gainM,
    lossM,
    minM: known.length > 0 ? Math.min(...known) : null,
    maxM: known.length > 0 ? Math.max(...known) : null,
  };
}
