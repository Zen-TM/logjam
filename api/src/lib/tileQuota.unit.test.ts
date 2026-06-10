import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: { topoJob: { aggregate: vi.fn() } },
}));

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getWeeklyTileUsage, assertCanSubmit } from "./tileQuota";

const aggregate = (prisma as unknown as { topoJob: { aggregate: Mock } }).topoJob.aggregate;

beforeEach(() => aggregate.mockReset());

describe("getWeeklyTileUsage", () => {
  it("sums tileCount and reports quota + resetAt", async () => {
    aggregate.mockResolvedValue({ _sum: { tileCount: 120 } });
    const usage = await getWeeklyTileUsage("u1", 500);
    expect(usage.used).toBe(120);
    expect(usage.quota).toBe(500);
    expect(typeof usage.resetAt).toBe("string");
    expect(new Date(usage.resetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("treats a null sum as zero usage", async () => {
    aggregate.mockResolvedValue({ _sum: { tileCount: null } });
    const usage = await getWeeklyTileUsage("u1", 500);
    expect(usage.used).toBe(0);
  });

  it("excludes uploading and failed jobs from the aggregate", async () => {
    aggregate.mockResolvedValue({ _sum: { tileCount: 0 } });
    await getWeeklyTileUsage("u1", 500);
    const where = aggregate.mock.calls[0][0].where;
    expect(where.status).toEqual({ notIn: ["uploading", "failed"] });
  });
});

describe("assertCanSubmit", () => {
  const user = { id: "u1", weeklyTileQuota: 100 };

  it("is a no-op when tileCount is falsy", async () => {
    await expect(assertCanSubmit(user, 0)).resolves.toBeUndefined();
    await expect(assertCanSubmit(user, null)).resolves.toBeUndefined();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("passes when used + requested is within quota", async () => {
    aggregate.mockResolvedValue({ _sum: { tileCount: 40 } });
    await expect(assertCanSubmit(user, 60)).resolves.toBeUndefined();
  });

  it("throws 429 with quota details when exceeded", async () => {
    aggregate.mockResolvedValue({ _sum: { tileCount: 80 } });
    const err = await assertCanSubmit(user, 30).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(429);
    expect(err.details.used).toBe(80);
    expect(err.details.quota).toBe(100);
    expect(err.details.resetAt).toBeTypeOf("string");
  });

  it("passes when used + requested lands exactly at quota", async () => {
    aggregate.mockResolvedValue({ _sum: { tileCount: 40 } });
    await expect(assertCanSubmit(user, 60)).resolves.toBeUndefined();
  });

  it("throws 429 one tile over the boundary", async () => {
    aggregate.mockResolvedValue({ _sum: { tileCount: 40 } });
    await expect(assertCanSubmit(user, 61)).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  // ARCH-009: /start runs the authoritative check inside a user-row-locked
  // transaction and passes `tx`; the aggregate must go through that client.
  it("aggregates through the provided transaction client", async () => {
    const tx = {
      topoJob: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { tileCount: 10 } }),
      },
    };
    await assertCanSubmit(user, 20, tx as never);
    expect(tx.topoJob.aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate).not.toHaveBeenCalled();
  });
});
