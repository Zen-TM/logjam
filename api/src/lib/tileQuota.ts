import prisma from "../services/prisma";
import { currentWeekStart, nextWeekReset } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
import type { DbClient } from "./storageQuota";

export async function getWeeklyTileUsage(
  userId: string,
  weeklyTileQuota: number,
  db: DbClient = prisma,
) {
  const result = await db.topoJob.aggregate({
    _sum: { tileCount: true },
    where: {
      userId,
      status: { notIn: ["uploading", "failed"] },
      createdAt: { gte: currentWeekStart() },
    },
  });
  return {
    used: result._sum.tileCount ?? 0,
    quota: weeklyTileQuota,
    resetAt: nextWeekReset().toISOString(),
  };
}

/**
 * Throws 429 when submitting `tileCount` would exceed the weekly quota.
 *
 * Read-then-throw is racy on its own: the authoritative call in /start runs
 * inside a transaction that locks the user row (`SELECT … FOR UPDATE`) and
 * passes `db = tx`, so concurrent submissions serialise (ARCH-009). Callers
 * outside such a transaction (the POST advisory pre-check) get best-effort
 * semantics, which is all they need.
 */
export async function assertCanSubmit(
  user: { id: string; weeklyTileQuota: number },
  tileCount: number | null | undefined,
  db: DbClient = prisma,
) {
  if (!tileCount) return;
  const { used, quota, resetAt } = await getWeeklyTileUsage(user.id, user.weeklyTileQuota, db);
  if (used + tileCount > quota) {
    throw new AppError(429, "Weekly tile quota exceeded", { used, quota, resetAt });
  }
}
