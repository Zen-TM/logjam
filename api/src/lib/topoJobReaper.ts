import prisma from "../services/prisma";
import { getEnv } from "./env";
import { logger } from "./logger";

// Stuck-topo-job reaper (ARCH-002).
//
// The job model is "ECS RunTask owns lifecycle; TopoJob.status owns retry; no
// SQS". Nothing transitions a job out of `pending`/`processing` except the
// worker's own success/except path, so two failure modes strand a job forever:
//
//   (a) RunTask placed the task but it never started (image-pull, ENI, capacity)
//       → job stays `pending`. The synchronous `.failures` check in
//       routes/topoJobs.ts catches the *placement* failure, but not a task that
//       was placed and then died before the Python process came up.
//   (b) The Fargate container was SIGKILLed (spot reclaim, OOM, task stopped)
//       before the worker's `except` ran → job stays `processing`.
//
// This sweep force-fails jobs that have been stuck past a generous timeout. It
// is intentionally conservative: the processing timeout is hours, well beyond a
// legitimate long job, so it only reaps jobs that are genuinely dead.
//
// Single-instance assumption: like the in-memory rate limiters (ARCH-007), this
// in-API sweep assumes one API instance. With >1 instance multiple sweeps would
// race, but the update is idempotent (only flips still-stuck rows to `failed`)
// so a double-sweep is harmless. If the deployment scales horizontally, move
// this to an EventBridge→Lambda or scheduled ECS task instead.

const REAPER_ERROR_MESSAGE =
  "Processing timed out — the job did not complete in the expected time and was marked failed. You can retry it.";

/**
 * One reaper pass. Marks `pending` jobs older than the pending timeout and
 * `processing` jobs older than the processing timeout as `failed`. Returns the
 * number of jobs reaped. Throws on DB error (fail loud — the caller logs).
 */
export async function reapStuckTopoJobs(now: Date = new Date()): Promise<number> {
  const env = getEnv();
  const pendingCutoff = new Date(now.getTime() - env.TOPO_REAPER_PENDING_TIMEOUT_MS);
  const processingCutoff = new Date(now.getTime() - env.TOPO_REAPER_PROCESSING_TIMEOUT_MS);

  // `pending`: anchored on updatedAt (set when /start flipped it to pending).
  // `processing`: anchored on startedAt (set by the worker when it begins);
  // fall back to updatedAt for older rows that predate the startedAt column.
  const result = await prisma.$transaction([
    prisma.topoJob.updateMany({
      where: { status: "pending", updatedAt: { lt: pendingCutoff } },
      data: { status: "failed", errorMessage: REAPER_ERROR_MESSAGE },
    }),
    prisma.topoJob.updateMany({
      where: {
        status: "processing",
        OR: [
          { startedAt: { lt: processingCutoff } },
          { startedAt: null, updatedAt: { lt: processingCutoff } },
        ],
      },
      data: { status: "failed", errorMessage: REAPER_ERROR_MESSAGE },
    }),
  ]);

  return result.reduce((sum, r) => sum + r.count, 0);
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic reaper. No-op if TOPO_REAPER_INTERVAL_MS is 0. Safe to call
 * once at boot; the returned stop function clears the timer for graceful
 * shutdown / tests.
 */
export function startTopoJobReaper(): () => void {
  const env = getEnv();
  if (env.TOPO_REAPER_INTERVAL_MS === 0) {
    logger.info("topo_job_reaper_disabled");
    return () => {};
  }

  const runOnce = () => {
    reapStuckTopoJobs()
      .then((count) => {
        if (count > 0) logger.warn({ count }, "topo_jobs_reaped");
      })
      .catch((err) => {
        // Don't crash the sweep loop on a transient DB error — log and retry
        // next interval.
        logger.error({ err }, "topo_job_reaper_failed");
      });
  };

  // Run once shortly after boot (catches jobs stranded while the API was down),
  // then on the configured interval.
  timer = setInterval(runOnce, env.TOPO_REAPER_INTERVAL_MS);
  timer.unref(); // don't keep the process alive for the reaper alone
  setTimeout(runOnce, 10_000).unref();

  logger.info(
    {
      intervalMs: env.TOPO_REAPER_INTERVAL_MS,
      pendingTimeoutMs: env.TOPO_REAPER_PENDING_TIMEOUT_MS,
      processingTimeoutMs: env.TOPO_REAPER_PROCESSING_TIMEOUT_MS,
    },
    "topo_job_reaper_started",
  );

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
