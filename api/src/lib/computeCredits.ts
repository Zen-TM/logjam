import prisma from "../services/prisma";
import {
  say,
  currentMonthStart,
  nextMonthReset,
  estimateCredits,
  type WorkerKind,
} from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
import { getEnv } from "./env";
import type { DbClient } from "./storageQuota";

/**
 * The per-user monthly worker allowance, in credits (= vCPU-minutes).
 *
 * Replaces the tile quota, which only ever constrained the topo worker. Usage
 * is DERIVED from the job tables rather than accumulated into a counter
 * column — there is no "charge" step for a worker to forget to call, and no
 * way for the counter to drift from the jobs it claims to describe.
 *
 * Running jobs are charged at their elapsed-so-far, not at zero. That costs
 * nothing extra (it is the same query) and removes most of the overshoot that
 * a purely on-completion charge would allow: without it, a user could hold
 * five 3-hour exports open and show zero usage the entire time.
 *
 * What deleting a job would erase is the one thing that is stored: a delete
 * trigger carries the row's credits over (see `creditsUsedThisMonth`).
 *
 * Deliberately NOT reserve-then-reconcile: nothing is written at submit, so
 * there is no reservation to leak when a job dies between the pre-check and
 * the launch. The residual overshoot is bounded by the per-user concurrency
 * caps × the reaper's runtime ceilings — about 60 credits' worth of work,
 * once, at a month boundary.
 */

/**
 * Credits used this month by `userId`, or by every account when it is null.
 *
 * What rows that exist cost is derived from the job tables with the SQL
 * functions `topo_job_credits` and `topo_export_job_credits` (migration
 * 20261110000000_compute_usage_carryover): the same functions a delete trigger
 * uses to carry a deleted row's credits into `compute_usage_carryover` and
 * `site_compute_carryover`, so deleting a finished job, or a sweep deleting an
 * export, never lowers usage. Guard: `__tests__/computeUsageCarryover.test.ts`.
 *
 * Elapsed time per job, in priority order:
 *  1. topo only — `pipeline_metrics.wallSeconds`, the worker's own measurement.
 *     Preferred because topo_jobs has no completed_at and `updated_at` keeps
 *     moving after completion, which would inflate the charge.
 *  2. still running — NOW() - started_at, so in-flight work counts immediately.
 *  3. finished without metrics (a failure, mostly) — the row's end timestamp.
 *
 * started_at IS NULL means the task never launched, so uploading/pending/queued
 * rows contribute nothing and cost the user nothing.
 */
async function creditsUsedThisMonth(
  userId: string | null,
  db: DbClient,
): Promise<number> {
  const monthStart = currentMonthStart();

  const rows = await db.$queryRaw<
    { derived: bigint | null; carried: bigint | null }[]
  >`
    SELECT
      (SELECT COALESCE(SUM(credits), 0)::bigint FROM (
        SELECT topo_job_credits(status, pipeline_metrics, started_at, updated_at) AS credits
        FROM topo_jobs
        WHERE started_at IS NOT NULL
          AND started_at >= ${monthStart}
          AND (${userId}::text IS NULL OR user_id = ${userId})

        UNION ALL

        SELECT topo_export_job_credits(completed_at, started_at)
        FROM topo_export_jobs
        WHERE started_at IS NOT NULL
          AND started_at >= ${monthStart}
          AND (${userId}::text IS NULL OR user_id = ${userId})
      ) AS per_job) AS derived,
      (SELECT COALESCE(SUM(credits), 0)::bigint FROM (
        SELECT credits FROM compute_usage_carryover
        WHERE ${userId}::text IS NOT NULL AND user_id = ${userId}
          AND month_start >= ${monthStart}
        UNION ALL
        SELECT credits FROM site_compute_carryover
        WHERE ${userId}::text IS NULL AND month_start >= ${monthStart}
      ) AS carried_over) AS carried
  `;

  // A clock skew that puts completed_at before started_at would make a job's
  // contribution negative and could mask real usage. Floor the derived total at
  // 0; the carry-over is never negative.
  return (
    Math.max(0, Number(rows[0]?.derived ?? 0)) + Number(rows[0]?.carried ?? 0)
  );
}

export async function getMonthlyCreditUsage(
  userId: string,
  monthlyComputeCredits: number,
  db: DbClient = prisma,
) {
  const used = await creditsUsedThisMonth(userId, db);

  return {
    used,
    quota: monthlyComputeCredits,
    remaining: Math.max(0, monthlyComputeCredits - used),
    resetAt: nextMonthReset().toISOString(),
  };
}

/** Credits used this month by every account, deleted ones included. */
export function getSiteCreditUsage(db: DbClient = prisma): Promise<number> {
  return creditsUsedThisMonth(null, db);
}

/** What a refusal for the site-wide pool says, here and in POST /compute-estimate. */
export const POOL_SPENT_SENTENCE = say`The processing credits everyone on Logjam shares are used up for this month. Try again next month.`;

/**
 * Whether the site-wide pool is spent, or cannot hold a job of `projected`
 * credits (null = no estimate: refused only once spent).
 */
export async function poolHasNoRoomFor(
  projected: number | null,
  db: DbClient = prisma,
): Promise<boolean> {
  const poolCap = getEnv().SITE_MONTHLY_COMPUTE_CREDITS;
  if (poolCap === 0) return false;
  const siteUsed = await getSiteCreditUsage(db);
  return (
    siteUsed >= poolCap ||
    (projected !== null && siteUsed + projected > poolCap)
  );
}

/**
 * Throws 429 when submitting a job of `kind` expected to take
 * `estimatedSeconds` would exceed the monthly allowance.
 *
 * Read-then-throw is racy on its own; the authoritative call sites run inside a
 * transaction that locks the user row (`SELECT … FOR UPDATE`) and pass `db =
 * tx`, so concurrent submissions serialise — the same treatment the per-user
 * concurrency caps get.
 *
 * A null estimate means the adaptive estimator has too little history to have
 * an opinion. That must NOT be read as "free": the job is still admitted only
 * when the user has headroom left, and the real elapsed time is charged
 * afterwards like any other run.
 */
export async function assertHasCredits(
  user: { id: string; monthlyComputeCredits: number },
  kind: WorkerKind,
  estimatedSeconds: number | null | undefined,
  db: DbClient = prisma,
): Promise<void> {
  const projected = estimateCredits(kind, estimatedSeconds);
  const usage = await getMonthlyCreditUsage(
    user.id,
    user.monthlyComputeCredits,
    db,
  );

  // Already spent: refuse regardless of what this job is expected to cost.
  // Also the only check available when there is no estimate.
  const wouldExceed =
    usage.used >= usage.quota ||
    (projected !== null && usage.used + projected > usage.quota);

  if (wouldExceed) {
    // Only used/quota/resetAt: AppErrorDetails is a deliberate whitelist
    // (errorHandler.ts) and the projected cost is not worth widening it for —
    // clients get the same number up front from POST /compute-estimate.
    throw new AppError(
      429,
      say`You've used all of this month's processing credits.`,
      {
        used: usage.used,
        quota: usage.quota,
        resetAt: usage.resetAt,
      },
    );
  }

  // The site-wide pool, after the user's own allowance so a user over their own
  // is told that. Only the reset date goes back: the pool's size and use are not
  // the user's to see, and AppErrorDetails is a whitelist.
  //
  // ponytail: no reservation. A job counts at its elapsed time, and the pool is
  // not serialised across users, so jobs admitted just under the cap keep
  // running past it: at most MAX_CONCURRENT_WORKER_VCPUS (24) for the longest
  // reaper ceiling (TOPO_REAPER_PROCESSING_TIMEOUT_MS, 6 h), 8640 credits,
  // about US$8.60. Reserve each job's credits at its reaper deadline when that
  // matters (issue #567).
  if (await poolHasNoRoomFor(projected, db)) {
    throw new AppError(429, POOL_SPENT_SENTENCE, { resetAt: usage.resetAt });
  }
}
