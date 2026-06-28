// Adaptive topo-job runtime estimator.
//
// The pipeline is a moving target (render perf has changed materially as the
// renderer is optimised), so a hardcoded seconds-per-tile constant goes stale.
// Instead, fit the estimate from recent completed jobs' actual runtimes and
// fall back to a configurable default until enough samples exist.
//
// Model: post-render-optimisation, render time is ~linear in output tiles and
// output tiles ∝ input tiles, so total runtime is ~linear in INPUT tiles —
// which is the only size signal known at submit time. We therefore fit a
// per-input-tile rate and key the estimate on input tile count.

import { median, quantile } from "./stats.js";

export interface JobActual {
  inputTileCount: number;
  /** Persisted for future model refinement; not used by the current fit. */
  outputTileCount?: number;
  wallSeconds: number;
}

export interface EstimateOptions {
  /** Cold-start rate used until at least `minSamples` usable actuals exist. */
  defaultSecondsPerInputTile: number;
  /** Minimum usable samples before trusting the fitted rate. */
  minSamples: number;
  /** Fixed per-job floor (extract/PDAL setup) added on top of the rate term. */
  overheadSeconds?: number;
}

const DEFAULT_OVERHEAD_SECONDS = 120;

function usableActuals(actuals: JobActual[]): JobActual[] {
  return actuals.filter(
    (a) =>
      Number.isFinite(a.inputTileCount) &&
      a.inputTileCount > 0 &&
      Number.isFinite(a.wallSeconds) &&
      a.wallSeconds > 0,
  );
}

/**
 * Resolve the per-input-tile rate (seconds/tile) from history, or the
 * cold-start default when there aren't enough samples. `pickRate` selects the
 * central rate (median) vs a conservative rate (e.g. p90) from the sample set.
 */
function resolveRate(
  actuals: JobActual[],
  opts: EstimateOptions,
  pickRate: (rates: number[]) => number | null,
): number {
  const usable = usableActuals(actuals);
  if (usable.length < opts.minSamples) {
    return opts.defaultSecondsPerInputTile;
  }
  const rates = usable.map((a) => a.wallSeconds / a.inputTileCount);
  return pickRate(rates) ?? opts.defaultSecondsPerInputTile;
}

function project(
  inputTileCount: number,
  rate: number,
  overheadSeconds: number,
): number {
  return Math.round(overheadSeconds + rate * inputTileCount);
}

/**
 * Central runtime estimate (median rate) — the value shown to the user as an
 * ETA. Uses the cold-start default below `minSamples`.
 */
export function estimateRuntimeSeconds(
  actuals: JobActual[],
  inputTileCount: number,
  opts: EstimateOptions,
): number {
  const overhead = opts.overheadSeconds ?? DEFAULT_OVERHEAD_SECONDS;
  const rate = resolveRate(actuals, opts, (rates) => median(rates));
  return project(inputTileCount, rate, overhead);
}

/**
 * Conservative runtime budget (p90 rate) — for any deadline/budget use that
 * must tolerate a slower-than-typical job without false-failing it. Always >=
 * the central estimate for the same inputs.
 */
export function estimateBudgetSeconds(
  actuals: JobActual[],
  inputTileCount: number,
  opts: EstimateOptions,
): number {
  const overhead = opts.overheadSeconds ?? DEFAULT_OVERHEAD_SECONDS;
  const rate = resolveRate(actuals, opts, (rates) => quantile(rates, 0.9));
  return project(inputTileCount, rate, overhead);
}
