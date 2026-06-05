import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    topoJob: { updateMany: vi.fn() },
    // $transaction receives the array of updateMany results and returns it.
    $transaction: vi.fn(),
  },
}));

import prisma from "../services/prisma";
import { reapStuckTopoJobs } from "./topoJobReaper";
import { getEnv } from "./env";

const updateMany = (prisma as unknown as { topoJob: { updateMany: Mock } }).topoJob.updateMany;
const transaction = (prisma as unknown as { $transaction: Mock }).$transaction;

beforeEach(() => {
  updateMany.mockReset();
  transaction.mockReset();
  // updateMany returns its own arg so we can inspect the where clauses later;
  // $transaction returns fixed counts so we can assert the sum.
  updateMany.mockImplementation((arg) => arg);
  transaction.mockResolvedValue([{ count: 2 }, { count: 1 }]);
});

describe("reapStuckTopoJobs", () => {
  it("returns the total number of jobs reaped across both sweeps", async () => {
    const count = await reapStuckTopoJobs(new Date("2026-06-05T12:00:00.000Z"));
    expect(count).toBe(3);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("anchors the pending cutoff on the pending timeout", async () => {
    const env = getEnv();
    const now = new Date("2026-06-05T12:00:00.000Z");
    await reapStuckTopoJobs(now);
    const pendingUpdate = updateMany.mock.calls[0][0];
    expect(pendingUpdate.where.status).toBe("pending");
    expect(pendingUpdate.where.updatedAt.lt).toEqual(
      new Date(now.getTime() - env.TOPO_REAPER_PENDING_TIMEOUT_MS),
    );
    expect(pendingUpdate.data.status).toBe("failed");
  });

  it("anchors the processing cutoff on startedAt with an updatedAt fallback", async () => {
    const env = getEnv();
    const now = new Date("2026-06-05T12:00:00.000Z");
    await reapStuckTopoJobs(now);
    const processingUpdate = updateMany.mock.calls[1][0];
    const cutoff = new Date(now.getTime() - env.TOPO_REAPER_PROCESSING_TIMEOUT_MS);
    expect(processingUpdate.where.status).toBe("processing");
    expect(processingUpdate.where.OR).toEqual([
      { startedAt: { lt: cutoff } },
      { startedAt: null, updatedAt: { lt: cutoff } },
    ]);
  });
});
