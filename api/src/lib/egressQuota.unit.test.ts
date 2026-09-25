import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  getEgressUsage,
  assertHasEgressQuota,
  exhaustedEgressOwnerIds,
} from "./egressQuota";

const users = prisma as unknown as {
  user: { findUnique: Mock; findMany: Mock };
};

const QUOTA = 50n * 1024n * 1024n * 1024n;

/** Somewhere inside the current month. */
const THIS_MONTH = new Date();
/** Comfortably before the current month started. */
const LAST_MONTH = new Date("2020-01-15T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getEgressUsage", () => {
  it("reports stored usage when the period is current", async () => {
    users.user.findUnique.mockResolvedValueOnce({
      monthlyEgressUsedBytes: 1000n,
      monthlyEgressQuotaBytes: QUOTA,
      egressPeriodStart: THIS_MONTH,
    });
    const usage = await getEgressUsage("user-1");
    expect(usage.used).toBe(1000n);
    expect(usage.remaining).toBe(QUOTA - 1000n);
  });

  it("reads a stale period as zero used", async () => {
    // The sweeper resets lazily on its next write. Without the same rollover on
    // the READ side, a user who was over the cap in a past month would stay
    // locked out until a sweep happened to touch their row.
    users.user.findUnique.mockResolvedValueOnce({
      monthlyEgressUsedBytes: QUOTA * 2n,
      monthlyEgressQuotaBytes: QUOTA,
      egressPeriodStart: LAST_MONTH,
    });
    const usage = await getEgressUsage("user-1");
    expect(usage.used).toBe(0n);
    expect(usage.remaining).toBe(QUOTA);
  });

  it("never reports negative remaining", async () => {
    users.user.findUnique.mockResolvedValueOnce({
      monthlyEgressUsedBytes: QUOTA + 1n,
      monthlyEgressQuotaBytes: QUOTA,
      egressPeriodStart: THIS_MONTH,
    });
    expect((await getEgressUsage("user-1")).remaining).toBe(0n);
  });

  it("404s for a missing user rather than reporting zero usage", async () => {
    users.user.findUnique.mockResolvedValueOnce(null);
    await expect(getEgressUsage("nobody")).rejects.toThrow(AppError);
  });
});

describe("assertHasEgressQuota", () => {
  it("admits a user under their allowance", async () => {
    users.user.findUnique.mockResolvedValueOnce({
      monthlyEgressUsedBytes: 1n,
      monthlyEgressQuotaBytes: QUOTA,
      egressPeriodStart: THIS_MONTH,
    });
    await expect(assertHasEgressQuota("user-1")).resolves.toBeUndefined();
  });

  it("refuses with 429 at or over the allowance", async () => {
    users.user.findUnique.mockResolvedValueOnce({
      monthlyEgressUsedBytes: QUOTA,
      monthlyEgressQuotaBytes: QUOTA,
      egressPeriodStart: THIS_MONTH,
    });
    try {
      await assertHasEgressQuota("user-1");
      expect.unreachable("should have thrown");
    } catch (err) {
      const appError = err as AppError;
      expect(appError.statusCode).toBe(429);
      // Byte counts ship as strings — they can exceed Number's safe range.
      expect(appError.details?.used).toBe(QUOTA.toString());
    }
  });

  it("admits an over-quota user whose period has rolled over", async () => {
    users.user.findUnique.mockResolvedValueOnce({
      monthlyEgressUsedBytes: QUOTA * 5n,
      monthlyEgressQuotaBytes: QUOTA,
      egressPeriodStart: LAST_MONTH,
    });
    await expect(assertHasEgressQuota("user-1")).resolves.toBeUndefined();
  });
});

describe("exhaustedEgressOwnerIds", () => {
  it("returns only the owners at or over their allowance", async () => {
    users.user.findMany.mockResolvedValueOnce([
      { id: "over", monthlyEgressUsedBytes: QUOTA, monthlyEgressQuotaBytes: QUOTA },
      { id: "under", monthlyEgressUsedBytes: 5n, monthlyEgressQuotaBytes: QUOTA },
    ]);
    const exhausted = await exhaustedEgressOwnerIds(["over", "under"]);
    expect([...exhausted]).toEqual(["over"]);
  });

  it("short-circuits on an empty list without querying", async () => {
    expect((await exhaustedEgressOwnerIds([])).size).toBe(0);
    expect(users.user.findMany).not.toHaveBeenCalled();
  });

  it("only considers rows whose period is current", async () => {
    // A stale period means usage is logically zero, so the query filters those
    // out rather than treating last month's total as this month's.
    users.user.findMany.mockResolvedValueOnce([]);
    await exhaustedEgressOwnerIds(["a"]);
    const where = users.user.findMany.mock.calls[0][0].where;
    expect(where.egressPeriodStart).toBeDefined();
  });
});
