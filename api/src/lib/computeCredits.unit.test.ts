import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: { $queryRaw: vi.fn() },
}));

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getMonthlyCreditUsage, assertHasCredits } from "./computeCredits";

const queryRaw = (prisma as unknown as { $queryRaw: Mock }).$queryRaw;

/** The aggregate query returns one row with a bigint sum. */
function usageOf(credits: number | bigint) {
  queryRaw.mockResolvedValueOnce([{ credits: BigInt(credits) }]);
}

const user = { id: "user-1", monthlyComputeCredits: 1200 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMonthlyCreditUsage", () => {
  it("returns used, quota, remaining and the reset instant", async () => {
    usageOf(300);
    const usage = await getMonthlyCreditUsage("user-1", 1200);
    expect(usage.used).toBe(300);
    expect(usage.quota).toBe(1200);
    expect(usage.remaining).toBe(900);
    expect(Date.parse(usage.resetAt)).not.toBeNaN();
  });

  it("treats no rows as zero usage rather than NaN", async () => {
    // A user with no jobs at all this month: COALESCE gives 0, but an empty
    // result set must not become NaN and silently disable the cap.
    queryRaw.mockResolvedValueOnce([]);
    const usage = await getMonthlyCreditUsage("user-1", 1200);
    expect(usage.used).toBe(0);
    expect(usage.remaining).toBe(1200);
  });

  it("floors a negative sum at zero", async () => {
    // completed_at before started_at (clock skew) would otherwise let a bad row
    // subtract from real usage and mask it.
    usageOf(-50);
    const usage = await getMonthlyCreditUsage("user-1", 1200);
    expect(usage.used).toBe(0);
  });

  it("never reports negative remaining when usage exceeds the quota", async () => {
    usageOf(2000);
    const usage = await getMonthlyCreditUsage("user-1", 1200);
    expect(usage.remaining).toBe(0);
  });
});

describe("assertHasCredits", () => {
  it("admits a job that fits in the remaining allowance", async () => {
    usageOf(100);
    // 8 vCPU × 60 s = 8 credits; 100 + 8 well under 1200.
    await expect(assertHasCredits(user, "topo", 60)).resolves.toBeUndefined();
  });

  it("refuses when the projected cost would cross the allowance", async () => {
    usageOf(1190);
    // topo at 8 vCPU × 300 s = 40 credits; 1190 + 40 > 1200.
    await expect(assertHasCredits(user, "topo", 300)).rejects.toThrow(AppError);
  });

  it("refuses on a 429 carrying used/quota/resetAt", async () => {
    usageOf(1200);
    try {
      await assertHasCredits(user, "geoPdf", 30);
      expect.unreachable("should have thrown");
    } catch (err) {
      const appError = err as AppError;
      expect(appError.statusCode).toBe(429);
      expect(appError.details).toMatchObject({ used: 1200, quota: 1200 });
      expect(appError.details?.resetAt).toBeTypeOf("string");
    }
  });

  it("refuses an already-exhausted user even with no estimate", async () => {
    // A null estimate means "unknown", never "free" — the exhausted check must
    // still bite or a user with no job history could bypass the cap entirely.
    usageOf(1200);
    await expect(assertHasCredits(user, "topo", null)).rejects.toThrow(AppError);
  });

  it("admits a user with headroom when the estimate is unknown", async () => {
    // The complement: an unknown estimate must not refuse someone who has
    // plenty left, or a brand-new deployment with no fitted history would
    // block every job.
    usageOf(10);
    await expect(assertHasCredits(user, "topo", null)).resolves.toBeUndefined();
  });

  it("prices the same runtime differently per worker", async () => {
    // 4 minutes: geoPdf costs 4 credits, topo costs 32. At 1180 used, only the
    // small one fits — this is the whole point of weighting by vCPU.
    usageOf(1180);
    await expect(assertHasCredits(user, "geoPdf", 240)).resolves.toBeUndefined();
    usageOf(1180);
    await expect(assertHasCredits(user, "topo", 240)).rejects.toThrow(AppError);
  });

  it("admits a job that exactly fills the allowance, then refuses the next", async () => {
    // The comparison is `used + cost > quota`, so a job landing exactly on the
    // allowance is admitted and the one after it is not.
    usageOf(1199);
    await expect(assertHasCredits(user, "geoPdf", 60)).resolves.toBeUndefined();
    usageOf(1200);
    await expect(assertHasCredits(user, "geoPdf", 60)).rejects.toThrow(AppError);
  });
});
