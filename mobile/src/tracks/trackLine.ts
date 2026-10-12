// A recorded or imported series, reduced to a line the DEM can be sampled
// along.
//
// The elevation hook keys its request on `JSON.stringify(points)` and
// re-densifies whatever it is given, and the API takes a bounded line, so a
// six-hour recording is thinned before it gets there.
//
// PRIVACY: these are precise wilderness coordinates. Nothing here logs.
import {
  ELEVATION_SMOOTHING_WINDOW,
  MAX_ROUTE_POINTS,
  movingMedian,
  type GpsFix,
  type TrackSeriesPoint,
} from "@logjam/shared";

/**
 * Vertices kept for a DEM sample. The DEM is read along the straight lines
 * between them, so the fewer there are the more a long track's line cuts
 * across the gullies and spurs the walked line went around: at 200 a 20 km
 * day had a vertex every 100 m.
 *
 * Short of what `POST /elevation/profile` takes (`MAX_ROUTE_POINTS`) on
 * purpose: every segment keeps at least two vertices whatever its share, so a
 * track with many short segments runs over this figure, and a line the API
 * refuses is one the public tiles get asked about instead.
 */
export const MAX_ELEVATION_VERTICES = Math.floor(MAX_ROUTE_POINTS * 0.8);

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
  return strided(points).map(({ run, kept }) =>
    kept.map((i) => [run[i]!.lon, run[i]!.lat]),
  );
}

/**
 * Every fix's GPS height, placed among the vertices `toElevationLine` keeps:
 * what fills the stretches no saved terrain covers (`fillDemFromGps` in
 * shared/src/trackStats.ts). ALL the fixes, not only the kept ones, so a
 * filled stretch's climb is summed from everything the phone recorded.
 * Median-smoothed per segment the way the track's own GPS climb is. A fix
 * that carried no height is left out.
 */
export function toElevationGpsFixes(
  points: readonly TrackSeriesPoint[],
): GpsFix[][] {
  return strided(points).map(({ run, kept }) => {
    const withHeight = run.flatMap((point, i) =>
      point.altitudeM != null && Number.isFinite(point.altitudeM) ? [i] : [],
    );
    const smoothed = movingMedian(
      withHeight.map((i) => run[i]!.altitudeM!),
      ELEVATION_SMOOTHING_WINDOW,
    );
    let k = 0;
    return withHeight.map((i, n) => {
      while (k < kept.length - 2 && kept[k + 1]! <= i) k++;
      return {
        vertex: k + (i - kept[k]!) / (kept[k + 1]! - kept[k]!),
        heightM: smoothed[n]!,
      };
    });
  });
}

/** Each segment, with the indices of the vertices the stride keeps. */
function strided(
  points: readonly TrackSeriesPoint[],
): { run: TrackSeriesPoint[]; kept: number[] }[] {
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
    const kept: number[] = [];
    for (let i = 0; i < quota; i++)
      kept.push(Math.round((i * (run.length - 1)) / (quota - 1)));
    return { run, kept };
  });
}
