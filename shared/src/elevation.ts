// Elevation profiles for drawn routes and the measure tool.
//
// The pure half lives here. The sampling itself has two readers, agreeing by
// construction because both sample through `sampleDem` in `demSources.ts`:
// api/src/services/elevation.ts fetches tiles (the online path, one warm cache
// for web and mobile), and mobile/src/offline/demLookup.ts reads them out of a
// downloaded region, so heights survive going offline.
//
// NOTHING HERE IS PERSISTED. Elevation is derived on demand from the point
// list plus the DEM, never stored on a Route or a point: a stored profile goes
// stale the moment a vertex moves, and would differ from a route drawn before
// the DEM existed. Route geometry stays the single source of truth.
//
// PRIVACY: a route's point list is precise wilderness location data. These
// helpers never log, and callers must keep points out of logs and error
// messages (root privacy rules).

import {
  DEM_SOURCES,
  GPS_CLIMB_SOURCE,
  type DemSamples,
} from "./demSources.js";
import { haversineMeters } from "./placeGeo.js";
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
 * The sample ceiling for a recorded or imported TRACK, which is asked for by
 * name (`maxSamples` on `POST /elevation/profile`). At the default ceiling a
 * 20 km day is read every 80 m: its climb under-reads, and a 5 m DEM is
 * wasted on it. This keeps the 25 m spacing out to about 51 km.
 *
 * ponytail: one request, however long the track. Past ~51 km the spacing
 * widens again; send the line in pieces if that ever matters.
 */
export const ELEVATION_TRACK_MAX_SAMPLES = 2048;

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
  /**
   * The DEM sources the heights were read from (`demSources.ts`), finest
   * first. Absent on a profile from an API that predates it.
   */
  demSourceIds?: string[];
  /**
   * True when a recorded track's own GPS heights stand in where no DEM had
   * one (`fillDemFromGps` in trackStats.ts). Its climb is then stored as GPS.
   */
  filledFromGps?: boolean;
};

/** A position to sample, with its distance along the line. */
export type SamplePosition = {
  lon: number;
  lat: number;
  distanceM: number;
  /**
   * Which piece of a line in several pieces the position is on. The ground
   * between two pieces was not walked (a pause gap), so no climb is counted
   * from one to the next. Absent on a line in one piece.
   */
  segment?: number;
};

/** The piece of the line a position or a fix is on: 0 when it does not say. */
export const lineSegmentOf = (at: { segment?: number }): number =>
  at.segment ?? 0;

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
 * Resample a MULTI-SEGMENT polyline to evenly spaced positions.
 *
 * The segment-aware form of `densifyLine`, for recorded tracks and imported
 * multi-line files: a pause/resume gap (or the join between two imported
 * lines) is ground the party did not cover, so no sample is ever placed on it
 * and nothing is interpolated across it. The walked length is the sum of the
 * segment lengths, and each segment is densified against a running distance
 * offset, so the profile's x axis runs continuously across the whole track
 * while the teleport between segments contributes nothing.
 *
 * Each position says which segment it is on, so the height difference across
 * a gap is not counted either (`sampleDem`, `fillDemFromGps`). Segments are
 * numbered as `gpsAlongLine` numbers them: among those with two points or
 * more.
 *
 * ponytail: the ground from a segment's last sample to its end, and from the
 * next one's start to its first sample, is in no step: up to one sample
 * spacing per gap. Sample each segment's two ends if that ever matters.
 */
export function densifyLineSegments(
  segments: readonly (readonly RoutePoint[])[],
  maxSamples: number = ELEVATION_PROFILE_MAX_SAMPLES,
): SamplePosition[] {
  // Single-point segments carry no distance and no teleport — drop them.
  const segs = segments.filter((s) => s.length >= 2);
  if (segs.length === 0) {
    for (const seg of segments) {
      if (seg.length > 0) {
        return [{ lon: seg[0]![0], lat: seg[0]![1], distanceM: 0 }];
      }
    }
    return [];
  }
  if (segs.length === 1) return densifyLine(segs[0]!, maxSamples);

  // Per-segment cumulative distances, and each segment's offset into the
  // combined walked length.
  const cumulative: number[][] = [];
  const offset: number[] = [];
  let totalM = 0;
  for (const seg of segs) {
    const cum: number[] = [0];
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1]!;
      const b = seg[i]!;
      cum.push(cum[i - 1]! + haversineMeters(a[1], a[0], b[1], b[0]));
    }
    offset.push(totalM);
    cumulative.push(cum);
    totalM += cum[cum.length - 1]!;
  }
  if (totalM === 0) {
    const first = segs[0]![0]!;
    return [{ lon: first[0], lat: first[1], distanceM: 0 }];
  }

  const sampleCount = Math.min(
    maxSamples,
    Math.max(2, Math.ceil(totalM / ELEVATION_SAMPLE_SPACING_M) + 1),
  );
  const step = totalM / (sampleCount - 1);

  const positions: SamplePosition[] = [];
  let segIndex = 0;
  for (let i = 0; i < sampleCount; i++) {
    const target = i === sampleCount - 1 ? totalM : i * step;
    // Advance past any segment that ends before this sample's distance.
    while (
      segIndex < segs.length - 1 &&
      offset[segIndex]! +
        cumulative[segIndex]![cumulative[segIndex]!.length - 1]! <
        target
    ) {
      segIndex++;
    }
    const seg = segs[segIndex]!;
    const cum = cumulative[segIndex]!;
    const local = target - offset[segIndex]!;
    // Walk the segment spine for `local` — same logic as densifyLine.
    let s = 1;
    while (s < cum.length - 1 && cum[s]! < local) s++;
    const startM = cum[s - 1]!;
    const endM = cum[s]!;
    const span = endM - startM;
    const t = span === 0 ? 0 : (local - startM) / span;
    const a = seg[s - 1]!;
    const b = seg[s]!;
    positions.push({
      lon: a[0] + (b[0] - a[0]) * t,
      lat: a[1] + (b[1] - a[1]) * t,
      distanceM: target,
      segment: segIndex,
    });
  }
  return positions;
}

/** A recorded track's GPS height at one fix, placed along its elevation line. */
export type GpsFix = {
  /**
   * Where the fix sits among its segment's vertices: 2 is the third vertex,
   * 2.5 a fix recorded halfway between the third and the fourth.
   */
  vertex: number;
  heightM: number;
};

/**
 * A GPS height at a distance along the line, in walked order. `segment` is
 * the one `SamplePosition` carries: the last fix before a pause gap and the
 * first after it share a distance, and only this tells them apart.
 */
export type GpsHeight = {
  distanceM: number;
  heightM: number;
  segment?: number;
};

/**
 * Every fix's height against the distance `densifyLineSegments` gives the
 * same line, so a fix and a sample position can be compared.
 *
 * `fixes` is parallel to `segments`, each in walked order. A line thinned to
 * a few vertices still carries every fix between them, which is what lets a
 * stretch be summed from all its fixes. Empty when the two shapes disagree.
 */
export function gpsAlongLine(
  segments: readonly (readonly RoutePoint[])[],
  fixes: readonly (readonly GpsFix[])[],
): GpsHeight[] {
  if (segments.length !== fixes.length) return [];
  const out: GpsHeight[] = [];
  let offsetM = 0;
  let segment = -1;
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k]!;
    if (seg.length < 2) continue;
    segment++;
    const atM: number[] = [0];
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1]!;
      const b = seg[i]!;
      atM.push(atM[i - 1]! + haversineMeters(a[1], a[0], b[1], b[0]));
    }
    for (const { vertex, heightM } of fixes[k]!) {
      if (!(vertex >= 0 && vertex <= seg.length - 1)) return [];
      const before = Math.min(Math.floor(vertex), seg.length - 2);
      out.push({
        distanceM:
          offsetM +
          atM[before]! +
          (vertex - before) * (atM[before + 1]! - atM[before]!),
        heightM,
        segment,
      });
    }
    offsetM += atM[atM.length - 1]!;
  }
  return out;
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

/**
 * Assemble a profile from sample positions and the heights read for them.
 *
 * The chart shows the heights as read; gain and loss are summed from the
 * levelled series, so neither a join between two DEM sources nor a pause gap
 * is ever counted as climb.
 */
export function buildElevationProfile(
  positions: readonly SamplePosition[],
  dem: DemSamples | readonly (number | null)[],
): ElevationProfile {
  const { heights, levelled, sourceIds }: DemSamples =
    "heights" in dem
      ? dem
      : { heights: [...dem], levelled: [...dem], sourceIds: [] };
  if (positions.length !== heights.length) {
    // Fail loudly: a misaligned pair would silently attribute heights to the
    // wrong distances, producing a plausible-looking but wrong profile.
    throw new Error("elevation sample count does not match position count");
  }
  const samples = positions.map((position, i) => ({
    distanceM: position.distanceM,
    elevationM: heights[i] ?? null,
  }));
  const known = heights.filter((value): value is number => value != null);
  const { gainM, lossM } = elevationGainLoss(
    ("climbSeries" in dem ? dem.climbSeries : undefined) ?? levelled,
    DEM_ELEVATION_HYSTERESIS_M,
  );
  const used = new Set(sourceIds);
  return {
    samples,
    gainM,
    lossM,
    minM: known.length > 0 ? Math.min(...known) : null,
    maxM: known.length > 0 ? Math.max(...known) : null,
    demSourceIds: DEM_SOURCES.map((source) => source.id).filter((id) =>
      used.has(id),
    ),
    ...(used.has(GPS_CLIMB_SOURCE) ? { filledFromGps: true } : {}),
  };
}

/** A track's climb and descent, with the source they were read from. */
export type TrackClimb = {
  elevationGainM: number;
  elevationLossM: number;
  /** One of `CLIMB_SOURCES`. */
  elevationSource: string;
};

/**
 * The climb a DEM profile gives a track, or null when it cannot give one.
 *
 * A sample with no height at all would sum a surface and nothing into one
 * figure, so such a profile gives no climb.
 *
 * The source recorded is the COARSEST any sample came from, so a track that
 * leaves the fine DEM's footprint for a while is offered again when the fine
 * one grows to cover it. That is GPS for a profile whose gaps the track's own
 * heights filled. A profile that does not say (an API older than
 * `demSourceIds`) is taken as the coarsest DEM for the same reason.
 */
export function climbFromProfile(
  profile: ElevationProfile | null,
): TrackClimb | null {
  if (!profile || profile.samples.length < 2) return null;
  if (profile.samples.some((sample) => sample.elevationM == null)) return null;
  const known = DEM_SOURCES.map((source) => source.id);
  const used = known.filter((id) => profile.demSourceIds?.includes(id));
  const read = used.length > 0 ? used : known;
  return {
    elevationGainM: profile.gainM,
    elevationLossM: profile.lossM,
    elevationSource: profile.filledFromGps
      ? GPS_CLIMB_SOURCE
      : read[read.length - 1]!,
  };
}
