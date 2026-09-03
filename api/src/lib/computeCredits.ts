import prisma from "../services/prisma";
import {
  currentMonthStart,
  nextMonthReset,
  WORKER_SPECS,
  estimateCredits,
  type WorkerKind,
} from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
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
 * Deliberately NOT reserve-then-reconcile: nothing is written at submit, so
 * there is no reservation to leak when a job dies between the pre-check and
 * the launch. The residual overshoot is bounded by the per-user concurrency
 * caps × the reaper's runtime ceilings — about 60 credits' worth of work,
 * once, at a month boundary.
 */

const VCPUS = {
  topo: WORKER_SPECS.topo.vcpus,
  topoExport: WORKER_SPECS.topoExport.vcpus,
  geoPdf: WORKER_SPECS.geoPdf.vcpus,
};

/**
 * Credits used this month, summed across all three worker tables.
 *
 * Elapsed time per job, in priority order:
 *  1. topo only — `pipeline_metrics.wallSeconds`, the worker's own measurement.
 *     Preferred because topo_jobs has no completed_at and `updated_at` keeps
 *     moving after completion (the reaper stamps auto_exported_at on it), which
 *     would inflate the charge.
 *  2. still running — NOW() - started_at, so in-flight work counts immediately.
 *  3. finished without metrics (a failure, mostly) — the row's end timestamp.
 *
 * started_at IS NULL means the task never launched, so uploading/pending/queued
 * rows contribute nothing and cost the user nothing.
 */
export async function getMonthlyCreditUsage(
  userId: string,
  monthlyComputeCredits: number,
  db: DbClient = prisma,
) {
  const monthStart = currentMonthStart();

  const rows = await db.$queryRaw<{ credits: bigint | null }[]>`
    SELECT COALESCE(SUM(credits), 0)::bigint AS credits
    FROM (
      SELECT CEIL(
        ${VCPUS.topo}::numeric * COALESCE(
          NULLIF((pipeline_metrics ->> 'wallSeconds'), '')::numeric,
          EXTRACT(EPOCH FROM (
            CASE WHEN status IN ('complete', 'failed') THEN updated_at ELSE NOW() END
            - started_at
          ))
        ) / 60.0
      ) AS credits
      FROM topo_jobs
      WHERE user_id = ${userId}::uuid
        AND started_at IS NOT NULL
        AND started_at >= ${monthStart}

      UNION ALL

      SELECT CEIL(
        ${VCPUS.topoExport}::numeric
        * EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))
        / 60.0
      )
      FROM topo_export_jobs
      WHERE user_id = ${userId}::uuid
        AND started_at IS NOT NULL
        AND started_at >= ${monthStart}

      UNION ALL

      SELECT CEIL(
        ${VCPUS.geoPdf}::numeric
        * EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))
        / 60.0
      )
      FROM geo_pdf_jobs
      WHERE user_id = ${userId}::uuid
        AND started_at IS NOT NULL
        AND started_at >= ${monthStart}
    ) AS per_job
  `;

  // A clock skew that puts completed_at before started_at would make a job's
  // contribution negative and could mask real usage. Floor the total at 0.
  const used = Math.max(0, Number(rows[0]?.credits ?? 0));

  return {
    used,
    quota: monthlyComputeCredits,
    remaining: Math.max(0, monthlyComputeCredits - used),
    resetAt: nextMonthReset().toISOString(),
  };
}

/**
 * Throws 429 when submitting a job of `kind` expected to take
 * `estimatedSeconds` would exceed the monthly allowance.
 *
 * Read-then-throw is racy on its own; the authoritative call sites run inside a
 * transaction that locks the user row (`SELECT … FOR UPDATE`) and pass `db =
 * tx`, so concurrent submissions serialise — the same treatment the per-user
 * concurrency caps get (ARCH-009).
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
  const usage = await getMonthlyCreditUsage(user.id, user.monthlyComputeCredits, db);

  // Already spent: refuse regardless of what this job is expected to cost.
  // Also the only check available when there is no estimate.
  const wouldExceed =
    usage.used >= usage.quota ||
    (projected !== null && usage.used + projected > usage.quota);

  if (wouldExceed) {
    // Only used/quota/resetAt: AppErrorDetails is a deliberate whitelist
    // (errorHandler.ts) and the projected cost is not worth widening it for —
    // clients get the same number up front from POST /compute-estimate.
    throw new AppError(429, "Monthly compute allowance exhausted", {
      used: usage.used,
      quota: usage.quota,
      resetAt: usage.resetAt,
    });
  }
}
