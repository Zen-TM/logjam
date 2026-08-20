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

/**
 * Stride-sample to at most `MAX_ELEVATION_VERTICES`, keeping the first and last
 * so the sampled line spans the whole track.
 *
 * Straight-line between kept vertices, which loses switchbacks — acceptable
 * here and only here: this line is used to ask "how high is the ground along
 * the way", never to measure distance (that comes from the full series) and
 * never to draw anything.
 */
export function toElevationLine(
  points: readonly TrackSeriesPoint[],
): [number, number][] {
  if (points.length < 2) return [];
  if (points.length <= MAX_ELEVATION_VERTICES) {
    return points.map((point) => [point.lon, point.lat]);
  }
  const line: [number, number][] = [];
  for (let i = 0; i < MAX_ELEVATION_VERTICES; i++) {
    const point =
      points[
        Math.round((i * (points.length - 1)) / (MAX_ELEVATION_VERTICES - 1))
      ]!;
    line.push([point.lon, point.lat]);
  }
  return line;
}
