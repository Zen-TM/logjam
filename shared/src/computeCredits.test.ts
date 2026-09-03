import { describe, it, expect } from "vitest";
import {
  creditsForRun,
  estimateCredits,
  quotaState,
  formatCredits,
  WORKER_SPECS,
  DEFAULT_MONTHLY_COMPUTE_CREDITS,
} from "./computeCredits.js";

describe("creditsForRun", () => {
  it("charges vCPU-minutes, so an 8 vCPU worker costs 8× a 1 vCPU one", () => {
    expect(creditsForRun("geoPdf", 60)).toBe(1);
    expect(creditsForRun("topoExport", 60)).toBe(4);
    expect(creditsForRun("topo", 60)).toBe(8);
  });

  it("rounds up — a flood of sub-minute jobs must not be free", () => {
    // The abuse shape a per-job-count limit misses: 1000 two-second renders.
    expect(creditsForRun("geoPdf", 2)).toBe(1);
    expect(creditsForRun("geoPdf", 1)).toBe(1);
  });

  it("treats non-positive and non-finite runtimes as zero", () => {
    // A clock skew or a null-ish elapsed must not produce NaN credits and
    // poison the monthly sum.
    expect(creditsForRun("topo", 0)).toBe(0);
    expect(creditsForRun("topo", -5)).toBe(0);
    expect(creditsForRun("topo", Number.NaN)).toBe(0);
    expect(creditsForRun("topo", Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("prices the reaper's ceiling runtimes sanely against the default quota", () => {
    // 6 h topo ceiling = 2880 credits, more than one month's allowance on its
    // own — deliberate: one runaway topo job should exhaust the budget.
    expect(creditsForRun("topo", 6 * 3600)).toBeGreaterThan(
      DEFAULT_MONTHLY_COMPUTE_CREDITS,
    );
    // A 30 min GeoPDF ceiling is 30 credits — 2.5% of the allowance, so normal
    // PDF use never feels the cap.
    expect(creditsForRun("geoPdf", 30 * 60)).toBe(30);
  });
});

describe("estimateCredits", () => {
  it("passes through a real estimate", () => {
    expect(estimateCredits("topoExport", 300)).toBe(20);
  });

  it("returns null for an absent estimate rather than 0", () => {
    // "Unknown" and "free" must never collapse: a null estimate means the
    // adaptive estimator has too little history, not that the job costs nothing.
    expect(estimateCredits("topo", null)).toBeNull();
    expect(estimateCredits("topo", undefined)).toBeNull();
    expect(estimateCredits("topo", 0)).toBeNull();
    expect(estimateCredits("topo", Number.NaN)).toBeNull();
  });
});

describe("quotaState", () => {
  it("reports remaining, fraction and the two flags", () => {
    const state = quotaState(600, 1200);
    expect(state.remaining).toBe(600);
    expect(state.fraction).toBe(0.5);
    expect(state.warning).toBe(false);
    expect(state.exhausted).toBe(false);
  });

  it("flags the warning band at 80%", () => {
    expect(quotaState(959, 1200).warning).toBe(false);
    expect(quotaState(960, 1200).warning).toBe(true);
  });

  it("clamps a quota lowered below existing usage", () => {
    // Dropping someone's allowance mid-month must read as "none left", never
    // as negative remaining or a fraction above 1.
    const state = quotaState(2000, 1200);
    expect(state.remaining).toBe(0);
    expect(state.fraction).toBe(1);
    expect(state.exhausted).toBe(true);
  });

  it("treats a zero quota as fully exhausted, not as a divide-by-zero", () => {
    const state = quotaState(0, 0);
    expect(state.fraction).toBe(1);
    expect(state.exhausted).toBe(true);
    expect(Number.isNaN(state.fraction)).toBe(false);
  });
});

describe("formatCredits", () => {
  it("shows raw credits while the number still means something", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(45)).toBe("45 credits");
  });

  it("switches to credit-hours once past ~90", () => {
    expect(formatCredits(120)).toBe("2.0 credit-hours");
    expect(formatCredits(1200)).toBe("20 credit-hours");
  });

  it("never renders a negative balance", () => {
    expect(formatCredits(-10)).toBe("0 credits");
  });
});

describe("WORKER_SPECS", () => {
  it("keeps every worker's vCPU count positive and integral", () => {
    // creditsForRun multiplies by this; a zero or fractional value would make
    // a whole worker class free or mis-billed.
    for (const spec of Object.values(WORKER_SPECS)) {
      expect(Number.isInteger(spec.vcpus)).toBe(true);
      expect(spec.vcpus).toBeGreaterThan(0);
    }
  });
});
