// When a track was at a spot: the answer to tapping a recorded line and asking
// "what time were we here?". A track can pass one spot more than once (an out
// and back, a lap), so the answer is a list.
import type { TrackSeriesPoint } from "./trackStats.js";

/**
 * One visit to the spot. `atMs` is the closest approach; `fromMs`..`toMs` is
 * how long the track stayed near it, which is the useful part of a lunch stop
 * and noise on a walk straight past.
 */
export type TrackPass = { atMs: number; fromMs: number; toMs: number };

/**
 * How much further from the spot than the track's closest approach still
 * counts as "here". Wide enough that the return leg of an out-and-back on the
 * same pad is found despite GPS scatter, narrow enough that the far side of a
 * creek is not.
 */
export const PASS_SLACK_M = 25;

/**
 * Two visits closer together than this are one: a party sitting at the edge
 * of the radius drifts in and out of it without having left.
 */
export const PASS_MERGE_MS = 5 * 60_000;

const M_PER_DEG = 111_195;

/**
 * Every time the track passed the spot, oldest first. Empty when the series
 * carries no timestamps (an imported GPX without `<time>`) or has no interval
 * to measure against.
 */
export function trackPassesNear(
  points: readonly TrackSeriesPoint[],
  spot: { lat: number; lon: number },
): TrackPass[] {
  // Local flat metres around the spot: exact enough over the few hundred
  // metres that matter, and it makes the closest point on an interval plain
  // vector arithmetic.
  const cosLat = Math.cos((spot.lat * Math.PI) / 180);
  const x = (p: TrackSeriesPoint) => (p.lon - spot.lon) * cosLat * M_PER_DEG;
  const y = (p: TrackSeriesPoint) => (p.lat - spot.lat) * M_PER_DEG;

  // The closest approach of each interval BETWEEN fixes, not of each fix:
  // fixes can be a hundred metres apart and the tap lands on the line drawn
  // between them.
  const approaches: {
    distanceM: number;
    atMs: number;
    start: { distanceM: number; atMs: number };
    end: { distanceM: number; atMs: number };
  }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    // The gap across a pause is drawn as no line, so it is not somewhere the
    // track was.
    if (a.segment !== b.segment) continue;
    if (a.timestampMs == null || b.timestampMs == null) return [];
    const dx = x(b) - x(a);
    const dy = y(b) - y(a);
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, -(x(a) * dx + y(a) * dy) / lengthSquared));
    approaches.push({
      distanceM: Math.hypot(x(a) + dx * t, y(a) + dy * t),
      atMs: a.timestampMs + (b.timestampMs - a.timestampMs) * t,
      start: { distanceM: Math.hypot(x(a), y(a)), atMs: a.timestampMs },
      end: { distanceM: Math.hypot(x(b), y(b)), atMs: b.timestampMs },
    });
  }
  if (approaches.length === 0) return [];

  const radiusM =
    Math.min(...approaches.map((approach) => approach.distanceM)) +
    PASS_SLACK_M;
  const passes: (TrackPass & { distanceM: number })[] = [];
  for (const approach of approaches) {
    if (approach.distanceM > radiusM) continue;
    // An interval with an end inside the radius was here until that fix, not
    // only at its closest moment: a stationary recorder writes no fixes, so a
    // long rest is ONE interval and would otherwise be a single instant.
    const fromMs =
      approach.start.distanceM <= radiusM ? approach.start.atMs : approach.atMs;
    const toMs =
      approach.end.distanceM <= radiusM ? approach.end.atMs : approach.atMs;
    const last = passes[passes.length - 1];
    if (last && fromMs - last.toMs < PASS_MERGE_MS) {
      last.toMs = Math.max(last.toMs, toMs);
      if (approach.distanceM < last.distanceM) {
        last.distanceM = approach.distanceM;
        last.atMs = approach.atMs;
      }
    } else {
      passes.push({
        atMs: approach.atMs,
        fromMs,
        toMs,
        distanceM: approach.distanceM,
      });
    }
  }
  return passes.map(({ atMs, fromMs, toMs }) => ({ atMs, fromMs, toMs }));
}
