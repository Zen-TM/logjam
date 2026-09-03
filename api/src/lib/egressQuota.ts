import prisma from "../services/prisma";
import { currentMonthStart, nextMonthReset } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
import type { DbClient } from "./storageQuota";

/**
 * The monthly S3 download allowance.
 *
 * Usage is written by the egress sweeper (lib/egressMeter.ts) from S3 server
 * access logs — the only place real transferred bytes are recorded. Nothing on
 * the request path can measure them: the API mints a presigned URL far more
 * often than anyone fetches it (lib/mediaPresign.ts signs one per photo on
 * every canyon read), so counting at mint time would over-charge by an order
 * of magnitude.
 *
 * The consequence is that this meter LAGS. Access-log delivery is best-effort
 * and can take hours, so the cap is an after-the-fact backstop that stops a
 * sustained drain, not a hard per-request gate that stops the first burst.
 * That is the right trade for a limit set far above real use.
 */

/** The stored period start belongs to a month that has already ended. */
function periodHasRolledOver(periodStart: Date, now = new Date()): boolean {
  return periodStart < currentMonthStart(now);
}

export async function getEgressUsage(userId: string, db: DbClient = prisma) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      monthlyEgressUsedBytes: true,
      monthlyEgressQuotaBytes: true,
      egressPeriodStart: true,
    },
  });
  if (!user) throw new AppError(404, "User not found");

  // Reads must apply the same lazy reset the sweeper's write does, or a user
  // whose sweep has not run since the 1st would keep seeing last month's total
  // and stay locked out into the new month.
  const rolledOver = periodHasRolledOver(user.egressPeriodStart);
  const used = rolledOver ? 0n : user.monthlyEgressUsedBytes;

  return {
    used,
    quota: user.monthlyEgressQuotaBytes,
    remaining: used >= user.monthlyEgressQuotaBytes ? 0n : user.monthlyEgressQuotaBytes - used,
    resetAt: nextMonthReset().toISOString(),
  };
}

/**
 * Which of `userIds` are out of download allowance, in one query.
 *
 * For list responses that mint many presigned URLs across several owners
 * (a canyon's media, a trip log's photos). Those degrade rather than fail: the
 * list still renders and the affected items come back with null URLs, because
 * 429-ing an entire canyon read over one owner's exhausted allowance would be
 * a far worse outcome than some images not loading.
 */
export async function exhaustedEgressOwnerIds(
  userIds: string[],
  db: DbClient = prisma,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const monthStart = currentMonthStart();
  const rows = await db.user.findMany({
    where: {
      id: { in: userIds },
      // Only rows whose period is current can be over — a stale period means
      // the sweeper has not run since the 1st and usage is logically zero.
      egressPeriodStart: { gte: monthStart },
    },
    select: {
      id: true,
      monthlyEgressUsedBytes: true,
      monthlyEgressQuotaBytes: true,
    },
  });
  return new Set(
    rows
      .filter((row) => row.monthlyEgressUsedBytes >= row.monthlyEgressQuotaBytes)
      .map((row) => row.id),
  );
}

/**
 * Throws 429 when `userId` has exhausted their monthly download allowance.
 *
 * Called with the OWNER of the bytes about to be served, which is not always
 * the caller: a sharee downloading a shared canyon's photos spends the canyon
 * owner's allowance, because the owner is who S3 attributes the object to.
 * Gating on the caller instead would leave the owner's allowance drainable by
 * anyone they had shared with.
 *
 * Uploads are deliberately NOT gated: S3 ingress is free, so an upload costs
 * nothing in egress, and upload volume is already bounded by the storage quota.
 */
export async function assertHasEgressQuota(
  userId: string,
  db: DbClient = prisma,
): Promise<void> {
  const { used, quota, resetAt } = await getEgressUsage(userId, db);
  if (used >= quota) {
    throw new AppError(429, "Monthly download allowance exhausted", {
      used: used.toString(),
      quota: quota.toString(),
      resetAt,
    });
  }
}
