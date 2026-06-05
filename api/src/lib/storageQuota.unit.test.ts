import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  getStorageUsage,
  assertHasStorageQuota,
  incrementStorageUsed,
  decrementStorageUsed,
} from "./storageQuota";

const findUnique = (prisma as unknown as { user: { findUnique: Mock } }).user.findUnique;
const executeRaw = (prisma as unknown as { $executeRaw: Mock }).$executeRaw;

beforeEach(() => {
  findUnique.mockReset();
  executeRaw.mockReset();
});

describe("getStorageUsage", () => {
  it("returns used and quota for a known user", async () => {
    findUnique.mockResolvedValue({ storageUsedBytes: 100n, storageQuotaBytes: 500n });
    await expect(getStorageUsage("u1")).resolves.toEqual({ used: 100n, quota: 500n });
  });

  it("throws 404 when the user is missing", async () => {
    findUnique.mockResolvedValue(null);
    await expect(getStorageUsage("u1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("assertHasStorageQuota", () => {
  it("passes when usage is under quota", async () => {
    findUnique.mockResolvedValue({ storageUsedBytes: 100n, storageQuotaBytes: 500n });
    await expect(assertHasStorageQuota("u1")).resolves.toBeUndefined();
  });

  it("throws 507 with string details when at or over quota", async () => {
    findUnique.mockResolvedValue({ storageUsedBytes: 500n, storageQuotaBytes: 500n });
    const err = await assertHasStorageQuota("u1").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(507);
    expect(err.details).toEqual({ used: "500", quota: "500" });
  });
});

describe("increment/decrement storage", () => {
  it("no-ops on non-positive byte counts", async () => {
    await incrementStorageUsed("u1", 0n);
    await decrementStorageUsed("u1", -5n);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("issues an UPDATE for a positive increment", async () => {
    await incrementStorageUsed("u1", 10n);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("issues an UPDATE for a positive decrement", async () => {
    await decrementStorageUsed("u1", 10n);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
