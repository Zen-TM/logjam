import { describe, it, expect } from "vitest";
import {
  estimateRuntimeSeconds,
  estimateBudgetSeconds,
  type JobActual,
  type EstimateOptions,
} from "./topoRuntimeEstimate.js";

const OPTS: EstimateOptions = {
  defaultSecondsPerInputTile: 510, // 8.5 min/tile cold-start
  minSamples: 3,
  overheadSeconds: 120,
};

function actual(inputTileCount: number, wallSeconds: number): JobActual {
  return { inputTileCount, wallSeconds };
}

describe("estimateRuntimeSeconds", () => {
  it("cold-start below minSamples uses the default rate", () => {
    const est = estimateRuntimeSeconds([actual(4, 200)], 10, OPTS);
    expect(est).toBe(120 + 510 * 10);
  });

  it("cold-start with no history at all", () => {
    expect(estimateRuntimeSeconds([], 5, OPTS)).toBe(120 + 510 * 5);
  });

  it("with >= minSamples uses the median per-tile rate", () => {
    // rates: 60, 60, 60 s/tile → median 60 → 120 + 60*8 = 600
    const actuals = [actual(4, 240), actual(2, 120), actual(10, 600)];
    expect(estimateRuntimeSeconds(actuals, 8, OPTS)).toBe(120 + 60 * 8);
  });

  it("median is robust to one slow outlier", () => {
    // rates: 60, 60, 60, 600 → median 60 (outlier ignored)
    const actuals = [
      actual(4, 240),
      actual(4, 240),
      actual(4, 240),
      actual(1, 600),
    ];
    expect(estimateRuntimeSeconds(actuals, 8, OPTS)).toBe(120 + 60 * 8);
  });

  it("ignores unusable actuals (zero tiles / zero seconds)", () => {
    // Only 2 usable → below minSamples → cold-start
    const actuals = [
      actual(0, 240),
      actual(4, 0),
      actual(4, 240),
      actual(2, 120),
    ];
    expect(estimateRuntimeSeconds(actuals, 10, OPTS)).toBe(120 + 510 * 10);
  });

  it("applies default overhead when unset", () => {
    const est = estimateRuntimeSeconds(
      [],
      2,
      { defaultSecondsPerInputTile: 100, minSamples: 3 },
    );
    expect(est).toBe(120 + 100 * 2); // DEFAULT_OVERHEAD_SECONDS = 120
  });
});

describe("estimateBudgetSeconds", () => {
  it("uses the p90 rate and is >= the central estimate", () => {
    const actuals = [
      actual(1, 50),
      actual(1, 55),
      actual(1, 60),
      actual(1, 65),
      actual(1, 600), // slow tail
    ];
    const eta = estimateRuntimeSeconds(actuals, 4, OPTS);
    const budget = estimateBudgetSeconds(actuals, 4, OPTS);
    expect(budget).toBeGreaterThan(eta);
  });

  it("cold-start budget equals cold-start estimate", () => {
    expect(estimateBudgetSeconds([], 5, OPTS)).toBe(
      estimateRuntimeSeconds([], 5, OPTS),
    );
  });
});
