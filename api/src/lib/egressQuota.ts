import prisma from "../services/prisma";
import { say, currentMonthStart, nextMonthReset } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
import { getEnv } from "./env";
import { logger } from "./logger";
import type { DbClient } from "./storageQuota";

/**
 * The monthly S3 download allowance.
 *
 * Usage is written by the egress sweeper (lib/egressMeter.ts) from S3 server
 * access logs — the only place real transferred bytes are recorded. Nothing on
 * the request path can measure them: the API mints a presigned URL far more
 * often than anyone fetches it (lib/mediaPresign.ts signs one per photo on
 * every place read), so counting at mint time would over-charge by an order
 * of magnitude.
 *
 * The consequence is that this meter LAGS. Access-log delivery is best-effort
 * and can take hours, so the cap is an after-the-fact backstop that stops a
 * sustained drain, not a hard per-request gate that stops the first burst.
 * That is the right trade for a limit set far above real use.
 */

/** What a refusal for the site-wide download cap says. */
const SITE_EGRESS_SPENT_SENTENCE = say`The downloads everyone on Logjam shares are used up for this month. Try again next month.`;

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
  if (!user)
    throw new AppError(
      404,
      say`Couldn't find your account. Sign out, then sign in again.`,
    );

  // Reads must apply the same lazy reset the sweeper's write does, or a user
  // whose sweep has not run since the 1st would keep seeing last month's total
  // and stay locked out into the new month. Guard: egressQuota.unit.test.ts ("reads a stale period as zero used").
  const rolledOver = periodHasRolledOver(user.egressPeriodStart);
  const used = rolledOver ? 0n : user.monthlyEgressUsedBytes;

  return {
    used,
    quota: user.monthlyEgressQuotaBytes,
    remaining:
      used >= user.monthlyEgressQuotaBytes
        ? 0n
        : user.monthlyEgressQuotaBytes - used,
    resetAt: nextMonthReset().toISOString(),
  };
}

/**
 * Whether everyone's downloads this month together have passed
 * SITE_MONTHLY_EGRESS_BYTES (0 = no cap).
 *
 * ponytail: a SUM over users per check, a scan per download. Keep a running
 * total when users number in the tens of thousands. The meter lags by hours
 * (S3 access logs), so downloads admitted before the logs arrive overshoot the
 * cap by that much; there is no reservation.
 */
async function siteEgressSpent(db: DbClient): Promise<boolean> {
  const siteCap = getEnv().SITE_MONTHLY_EGRESS_BYTES;
  if (siteCap === 0) return false;
  // A stale period counts as zero, as in getEgressUsage.
  const { _sum } = await db.user.aggregate({
    _sum: { monthlyEgressUsedBytes: true },
    where: { egressPeriodStart: { gte: currentMonthStart() } },
  });
  if ((_sum.monthlyEgressUsedBytes ?? 0n) < BigInt(siteCap)) return false;
  // No user data in the line; no alarm watches it yet.
  logger.warn({ siteCap }, "site_egress_cap_reached");
  return true;
}

/**
 * Which of `userIds` are out of download allowance, in one query.
 *
 * For list responses that mint many presigned URLs across several owners
 * (a place's media, a trip log's photos). Those degrade rather than fail: the
 * list still renders and the affected items come back with null URLs, because
 * 429-ing an entire place read over one owner's exhausted allowance would be
 * a far worse outcome than some images not loading.
 */
export async function exhaustedEgressOwnerIds(
  userIds: string[],
  db: DbClient = prisma,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  // The site-wide cap is spent: every owner's rows are omitted, as for one
  // out of their own allowance.
  if (await siteEgressSpent(db)) return new Set(userIds);
  const monthStart = currentMonthStart();
  const rows = await db.user.findMany({
    where: {
      id: { in: userIds },
      // Only rows whose period is current can be over — a stale period means
      // the sweeper has not run since the 1st and usage is logically zero. Guard: egressQuota.unit.test.ts ("only considers rows whose period is current").
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
      .filter(
        (row) => row.monthlyEgressUsedBytes >= row.monthlyEgressQuotaBytes,
      )
      .map((row) => row.id),
  );
}

/**
 * Throws 429 when `userId` has exhausted their monthly download allowance.
 *
 * Called with the OWNER of the bytes about to be served, which is not always
 * the caller: a sharee downloading a shared place's photos spends the place
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
    throw new AppError(
      429,
      say`You've used all of this month's download allowance.`,
      {
        used: used.toString(),
        quota: quota.toString(),
        resetAt,
      },
    );
  }

  // The site-wide cap, after the user's own so a user over theirs is told that.
  // Only the reset date goes back: the pool's size and use are not the user's
  // to see.
  if (await siteEgressSpent(db)) {
    throw new AppError(429, SITE_EGRESS_SPENT_SENTENCE, { resetAt });
  }
}
