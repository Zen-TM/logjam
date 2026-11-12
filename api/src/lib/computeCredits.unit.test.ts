import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: { $queryRaw: vi.fn() },
}));

// 0 = no site-wide cap, so the per-user tests make one query each; the pool
// tests set it.
const env = vi.hoisted(() => ({ SITE_MONTHLY_COMPUTE_CREDITS: 0 }));
vi.mock("./env", async (original) => {
  const real = await original<typeof import("./env")>();
  return { ...real, getEnv: () => ({ ...real.getEnv(), ...env }) };
});

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getMonthlyCreditUsage, assertHasCredits } from "./computeCredits";

const queryRaw = (prisma as unknown as { $queryRaw: Mock }).$queryRaw;

/** The usage query returns one row: credits derived from live job rows, and
 *  credits carried over from deleted ones. */
function usageOf(derived: number | bigint, carried: number | bigint = 0) {
  queryRaw.mockResolvedValueOnce([
    { derived: BigInt(derived), carried: BigInt(carried) },
  ]);
}

const user = { id: "user-1", monthlyComputeCredits: 1200 };

beforeEach(() => {
  vi.clearAllMocks();
  env.SITE_MONTHLY_COMPUTE_CREDITS = 0;
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

  it("adds what deleted jobs carried over to what live rows cost", async () => {
    usageOf(300, 100);
    expect((await getMonthlyCreditUsage("user-1", 1200)).used).toBe(400);
    // A skewed live row must not eat into the carry-over.
    usageOf(-50, 100);
    expect((await getMonthlyCreditUsage("user-1", 1200)).used).toBe(100);
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
      await assertHasCredits(user, "topoExport", 30);
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
    await expect(assertHasCredits(user, "topo", null)).rejects.toThrow(
      AppError,
    );
  });

  it("admits a user with headroom when the estimate is unknown", async () => {
    // The complement: an unknown estimate must not refuse someone who has
    // plenty left, or a brand-new deployment with no fitted history would
    // block every job.
    usageOf(10);
    await expect(assertHasCredits(user, "topo", null)).resolves.toBeUndefined();
  });

  it("prices the same runtime differently per worker", async () => {
    // 4 minutes: an export costs 16 credits, topo costs 32. At 1180 used, only the
    // small one fits — this is the whole point of weighting by vCPU.
    usageOf(1180);
    await expect(
      assertHasCredits(user, "topoExport", 240),
    ).resolves.toBeUndefined();
    usageOf(1180);
    await expect(assertHasCredits(user, "topo", 240)).rejects.toThrow(AppError);
  });

  it("admits a job that exactly fills the allowance, then refuses the next", async () => {
    // The comparison is `used + cost > quota`, so a job landing exactly on the
    // allowance is admitted and the one after it is not.
    usageOf(1196);
    await expect(
      assertHasCredits(user, "topoExport", 60),
    ).resolves.toBeUndefined();
    usageOf(1197);
    await expect(assertHasCredits(user, "topoExport", 60)).rejects.toThrow(
      AppError,
    );
  });
});

describe("assertHasCredits, the site-wide pool", () => {
  const POOL = 15000;
  beforeEach(() => {
    env.SITE_MONTHLY_COMPUTE_CREDITS = POOL;
  });

  // Mutation that turns the refusals red: skip the pool block in
  // assertHasCredits (or read getEnv().SITE_MONTHLY_COMPUTE_CREDITS as 0).
  it("refuses once the pool is spent, with the pool's sentence and only the reset date", async () => {
    usageOf(10); // the user is well inside their own allowance
    usageOf(POOL); // the pool is not
    try {
      await assertHasCredits(user, "topoExport", 30);
      expect.unreachable("should have thrown");
    } catch (err) {
      const appError = err as AppError;
      expect(appError.statusCode).toBe(429);
      expect(appError.message).toMatch(/everyone on Logjam/);
      expect(appError.details).toEqual({ resetAt: expect.any(String) });
    }
  });

  it("refuses a job the remaining pool cannot hold, and admits one it can", async () => {
    // topo at 60 s = 8 credits.
    usageOf(10);
    usageOf(POOL - 7);
    await expect(assertHasCredits(user, "topo", 60)).rejects.toThrow(AppError);
    usageOf(10);
    usageOf(POOL - 8);
    await expect(assertHasCredits(user, "topo", 60)).resolves.toBeUndefined();
  });

  it("refuses a spent pool even with no estimate", async () => {
    usageOf(10);
    usageOf(POOL);
    await expect(assertHasCredits(user, "topo", null)).rejects.toThrow(
      AppError,
    );
  });

  it("tells a user over their own allowance that first", async () => {
    usageOf(1200);
    await expect(assertHasCredits(user, "topo", 60)).rejects.toThrow(
      /used all of this month's/,
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("makes no pool query when the cap is 0", async () => {
    env.SITE_MONTHLY_COMPUTE_CREDITS = 0;
    usageOf(10);
    await expect(assertHasCredits(user, "topo", 60)).resolves.toBeUndefined();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
