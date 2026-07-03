import prisma from "../services/prisma";
import { currentMonthStart, nextMonthReset } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
import type { DbClient } from "./storageQuota";

export async function getMonthlyTileUsage(
  userId: string,
  monthlyTileQuota: number,
  db: DbClient = prisma,
) {
  const result = await db.topoJob.aggregate({
    _sum: { tileCount: true },
    where: {
      userId,
      status: { notIn: ["uploading", "failed"] },
      createdAt: { gte: currentMonthStart() },
    },
  });
  return {
    used: result._sum.tileCount ?? 0,
    quota: monthlyTileQuota,
    resetAt: nextMonthReset().toISOString(),
  };
}

/**
 * Throws 429 when submitting `tileCount` would exceed the monthly quota.
 *
 * Read-then-throw is racy on its own: the authoritative call in /start runs
 * inside a transaction that locks the user row (`SELECT … FOR UPDATE`) and
 * passes `db = tx`, so concurrent submissions serialise (ARCH-009). Callers
 * outside such a transaction (the POST advisory pre-check) get best-effort
 * semantics, which is all they need.
 */
export async function assertCanSubmit(
  user: { id: string; monthlyTileQuota: number },
  tileCount: number | null | undefined,
  db: DbClient = prisma,
) {
  if (!tileCount) return;
  const { used, quota, resetAt } = await getMonthlyTileUsage(user.id, user.monthlyTileQuota, db);
  if (used + tileCount > quota) {
    throw new AppError(429, "Monthly tile quota exceeded", { used, quota, resetAt });
  }
}
