// A recorded or imported series, reduced to a line the DEM can be sampled
// along.
//
// The elevation hook keys its request on `JSON.stringify(points)` and
// re-densifies whatever it is given, so handing it a six-hour recording means
// stringifying thousands of coordinate pairs on every render and sampling
// detail far below the DEM's own ~19 m/px. A couple of hundred vertices is
// already finer than the surface being read.
//
// PRIVACY: these are precise wilderness coordinates. Nothing here logs.
import type { TrackSeriesPoint } from "@logjam/shared";

/**
 * Vertices kept for a DEM sample. `densifyLine` resamples to
 * ELEVATION_PROFILE_MAX_SAMPLES (256) evenly spaced positions anyway, so more
 * input than this buys nothing but string length.
 */
export const MAX_ELEVATION_VERTICES = 200;

/** Consecutive runs of points sharing a `segment`, single-point runs dropped. */
function segmentRuns(
  points: readonly TrackSeriesPoint[],
): TrackSeriesPoint[][] {
  const runs: TrackSeriesPoint[][] = [];
  let current: TrackSeriesPoint[] = [];
  let currentSegment: number | null = null;
  for (const point of points) {
    if (currentSegment !== null && point.segment !== currentSegment) {
      // A single-point segment carries no distance and no teleport — drop it.
      if (current.length >= 2) runs.push(current);
      current = [];
    }
    currentSegment = point.segment;
    current.push(point);
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

/**
 * Stride-sample to at most `MAX_ELEVATION_VERTICES`, keeping the first and last
 * so the sampled line spans the whole track.
 *
 * Straight-line between kept vertices, which loses switchbacks — acceptable
 * here and only here: this line is used to ask "how high is the ground along
 * the way", never to measure distance (that comes from the full series) and
 * never to draw anything.
 *
 * Returns one sub-line PER SEGMENT so the DEM sampler (`densifyLineSegments`)
 * never draws a teleport line across a pause gap or the join between two
 * imported lines. A single-segment track returns one segment.
 *
 * The vertex budget is split BETWEEN segments in proportion to their point
 * counts rather than strided across the flattened series: a short segment
 * among long ones can win no stride slots that way, and a segment reduced to
 * one vertex is dropped as a break — silently removing walked ground from the
 * sampled line and, because the profile's x axis is scaled to the reported
 * distance, stretching the rest of the track to cover the hole.
 */
export function toElevationLine(
  points: readonly TrackSeriesPoint[],
): [number, number][][] {
  if (points.length < 2) return [];
  const runs = segmentRuns(points);
  const totalPoints = runs.reduce((count, run) => count + run.length, 0);
  if (totalPoints === 0) return [];
  return runs.map((run) => {
    const quota = Math.min(
      run.length,
      Math.max(
        2,
        Math.round((MAX_ELEVATION_VERTICES * run.length) / totalPoints),
      ),
    );
    const line: [number, number][] = [];
    for (let i = 0; i < quota; i++) {
      const point = run[Math.round((i * (run.length - 1)) / (quota - 1))]!;
      line.push([point.lon, point.lat]);
    }
    return line;
  });
}
