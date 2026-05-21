import prisma from "../services/prisma";
import { currentWeekStart, nextWeekReset } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";

export async function getWeeklyTileUsage(userId: string, weeklyTileQuota: number) {
  const result = await prisma.topoJob.aggregate({
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

export async function assertCanSubmit(
  user: { id: string; weeklyTileQuota: number },
  tileCount: number | null | undefined,
) {
  if (!tileCount) return;
  const { used, quota, resetAt } = await getWeeklyTileUsage(user.id, user.weeklyTileQuota);
  if (used + tileCount > quota) {
    throw new AppError(429, "Weekly tile quota exceeded", { used, quota, resetAt });
  }
}
