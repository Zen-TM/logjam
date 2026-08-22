import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    fileSend: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../services/awsClients", () => ({
  s3: { send: vi.fn() },
}));

vi.mock("./storageQuota", () => ({
  decrementStorageUsed: vi.fn(),
}));

import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { decrementStorageUsed } from "./storageQuota";
import { sweepExpiredFileSends } from "./fileSendReaper";

const findMany = (prisma as unknown as { fileSend: { findMany: Mock } })
  .fileSend.findMany;
const transaction = (prisma as unknown as { $transaction: Mock }).$transaction;
const s3Send = (s3 as unknown as { send: Mock }).send;
const decrement = decrementStorageUsed as unknown as Mock;

const NOW = new Date("2026-08-22T12:00:00Z");

const row = {
  id: "send-1",
  senderId: "sender-1",
  s3Key: "file-sends/sender-1/send-1/copy.gpx",
  sizeBytes: 4096n,
};

/**
 * Run the sweep with a transaction whose `deleteMany` reports `count` rows
 * removed — the whole point of the claim being the delete itself.
 */
function withDeleteCount(count: number) {
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ fileSend: { deleteMany: vi.fn().mockResolvedValue({ count }) } }),
  );
}

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([row]);
  transaction.mockReset();
  s3Send.mockReset().mockResolvedValue({});
  decrement.mockReset();
  withDeleteCount(1);
});

describe("sweepExpiredFileSends", () => {
  it("deletes the object and refunds the sender exactly once", async () => {
    expect(await sweepExpiredFileSends(NOW)).toBe(1);
    expect(s3Send).toHaveBeenCalledTimes(1);
    expect(decrement).toHaveBeenCalledTimes(1);
    expect(decrement).toHaveBeenCalledWith(
      "sender-1",
      4096n,
      expect.anything(),
    );
  });

  // The double-refund guard. Two API instances sweep the same row; Postgres
  // serialises the deletes and the loser removes nothing — so it must also
  // refund nothing, or the sender is credited twice for one file.
  it("refunds NOTHING when another instance already claimed the row", async () => {
    withDeleteCount(0);
    await sweepExpiredFileSends(NOW);
    expect(decrement).not.toHaveBeenCalled();
  });

  it("only looks at rows past their expiry", async () => {
    await sweepExpiredFileSends(NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { expiresAt: { lt: NOW } } }),
    );
  });

  // A missing object is the normal case: the S3 lifecycle rule is allowed to
  // win the race. What must not happen is the row surviving and the refund
  // being skipped forever.
  it("still sweeps when S3 reports the object already gone", async () => {
    s3Send.mockResolvedValue({});
    expect(await sweepExpiredFileSends(NOW)).toBe(1);
    expect(decrement).toHaveBeenCalledTimes(1);
  });

  // Per-row isolation, the convention expireCompletedExports follows: one bad
  // row must not wedge the rest of the sweep.
  it("skips a failing row and keeps going", async () => {
    findMany.mockResolvedValue([row, { ...row, id: "send-2" }]);
    s3Send.mockRejectedValueOnce(new Error("s3 down"));
    expect(await sweepExpiredFileSends(NOW)).toBe(1);
    expect(decrement).toHaveBeenCalledTimes(1);
  });

  it("returns 0 and touches nothing when there is nothing expired", async () => {
    findMany.mockResolvedValue([]);
    expect(await sweepExpiredFileSends(NOW)).toBe(0);
    expect(s3Send).not.toHaveBeenCalled();
    expect(decrement).not.toHaveBeenCalled();
  });
});
