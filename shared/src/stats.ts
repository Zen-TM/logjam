// Small pure statistics helpers. No stats dependency in the repo; these cover
// the median / quantile needs of the adaptive runtime estimator.

/** Median of a numeric list. Returns null for an empty list. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Linear-interpolated quantile (the "R-7" / Excel PERCENTILE.INC method).
 * `q` is clamped to [0, 1]. Returns null for an empty list.
 * quantile(xs, 0.5) === median(xs).
 */
export function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, q));
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = clamped * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}
