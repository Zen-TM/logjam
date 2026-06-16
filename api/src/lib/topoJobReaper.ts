import { StopTaskCommand } from "@aws-sdk/client-ecs";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import prisma from "../services/prisma";
import { ecs, s3 } from "../services/awsClients";
import { decrementStorageUsed } from "./storageQuota";
import { sweepOrphanedMediaUploads } from "./mediaOrphanSweeper";
import { createAndLaunchTopoExport } from "./topoExportLauncher";
import { AppError } from "../middleware/errorHandler";
import {
  TOPO_LAYERS,
  VECTOR_STYLE_DEFAULTS,
  reconcileExportSelection,
  validateAutoExportSettings,
  validateExportRequest,
  type TopoLayerKey,
} from "@logjam/shared";
import { getEnv } from "./env";
import { logger } from "./logger";

// Stuck-job reaper for both topo pipelines (Design L4).
//
// The job model is "ECS RunTask owns lifecycle; the status column owns retry;
// no SQS". Nothing transitions a job out of `pending`/`processing` (or an
// export out of `queued`/`running`) except the worker's own success/except
// path, so two failure modes strand a row forever:
//
//   (a) RunTask placed the task but it never started (image-pull, ENI,
//       capacity) → row stays `pending`/`queued`. The synchronous placement
//       check in lib/ecsRunTask.ts catches the *placement* failure, but not a
//       task that was placed and then died before the Python process came up.
//   (b) The Fargate container was SIGKILLed (spot reclaim, OOM, task stopped)
//       before the worker's `except` ran → row stays `processing`/`running`.
//
// Sweeps:
//   topo_jobs · pending          — flat timeout, anchored on updatedAt.
//   topo_jobs · processing       — per-job deadline (processingDeadline below):
//       the flat timeout is only a floor; jobs with an estimate get
//       ESTIMATE_SAFETY_FACTOR × estimatedSeconds, so a legitimately long
//       render (the API estimates ~8.5 min/tile — ~14 h at the default
//       100-tile quota) is never reaped mid-run (ARCH-001).
//   topo_export_jobs · queued    — flat timeout, anchored on createdAt.
//   topo_export_jobs · running   — flat timeout, anchored on startedAt
//       (createdAt fallback for rows that predate the startedAt column).
//
// Every reaped in-flight row with a persisted ecsTaskArn gets a best-effort
// ECS StopTask — a missed stop is harmless because the workers' terminal
// status writes are guarded (`WHERE status = ...`), so a reaped-but-alive
// task can no longer resurrect a failed row or charge storage (Design L1).
//
// Single-instance assumption: like the in-memory rate limiters, this in-API
// sweep assumes one API instance. With >1 instance multiple sweeps would
// race, but every update is status-guarded and idempotent, and StopTask is
// idempotent on stopped tasks, so a double-sweep is harmless. If the
// deployment scales horizontally, move this to an EventBridge→Lambda or
// scheduled ECS task instead.

// Retry means submitting a new job/export — the reaper never re-launches
// anything (see the attempt_count comment in schema.prisma, ARCH-008).
const REAPER_JOB_MESSAGE =
  "Processing timed out — the job did not complete in the expected time and was marked failed. Submit a new job to retry.";
const REAPER_EXPORT_MESSAGE =
  "The export did not complete in the expected time and was marked failed. Submit a new export to retry.";
const REAPER_GEO_PDF_MESSAGE =
  "GeoPDF generation timed out — the job did not complete in the expected time and was marked failed. Submit a new job to retry.";

// Headroom multiplier on the API's own duration estimate. A code constant,
// not an env knob: if real runtimes drift from the estimate, fix the estimate
// at its source (routes/topoJobs.ts), not here.
export const ESTIMATE_SAFETY_FACTOR = 2;

/**
 * Deadline after which a `processing` topo job is considered dead (pure —
 * prime unit-test target). Anchored on startedAt (written by the worker when
 * it begins), falling back to updatedAt for rows that predate the column.
 * The per-job budget is the flat processing timeout or twice the API's own
 * estimate, whichever is larger.
 */
export function processingDeadline(
  job: {
    startedAt: Date | null;
    updatedAt: Date;
    estimatedSeconds: number | null;
  },
  processingTimeoutMs: number,
): Date {
  const anchor = job.startedAt ?? job.updatedAt;
  const budgetMs = Math.max(
    processingTimeoutMs,
    job.estimatedSeconds !== null
      ? ESTIMATE_SAFETY_FACTOR * job.estimatedSeconds * 1000
      : 0,
  );
  return new Date(anchor.getTime() + budgetMs);
}

/**
 * Best-effort StopTask for reaped rows that still have a live Fargate task.
 * Never throws: a missed stop only costs Fargate time — the workers' guarded
 * terminal writes make a zombie task otherwise harmless.
 */
async function stopTasksBestEffort(
  rows: { id: string; ecsTaskArn: string | null }[],
  event: string,
): Promise<void> {
  const env = getEnv();
  for (const row of rows) {
    if (!row.ecsTaskArn) continue;
    try {
      await ecs.send(
        new StopTaskCommand({
          cluster: env.ECS_CLUSTER,
          task: row.ecsTaskArn,
          reason: "Reaped by topo job reaper",
        }),
      );
    } catch (err) {
      logger.warn({ err, id: row.id }, event);
    }
  }
}

/**
 * One reaper pass over both job tables. Returns the number of rows reaped.
 * Throws on DB error (fail loud — the caller logs). All updates are
 * status-guarded so a row that reaches a terminal state between read and
 * write is left untouched.
 */
export async function reapStuckTopoJobs(now: Date = new Date()): Promise<number> {
  const env = getEnv();
  let reaped = 0;

  // topo_jobs · pending: anchored on updatedAt (set when /start flipped it).
  const pendingCutoff = new Date(now.getTime() - env.TOPO_REAPER_PENDING_TIMEOUT_MS);
  const pendingResult = await prisma.topoJob.updateMany({
    where: { status: "pending", updatedAt: { lt: pendingCutoff } },
    data: { status: "failed", errorMessage: REAPER_JOB_MESSAGE },
  });
  reaped += pendingResult.count;

  // topo_jobs · processing: per-job deadline (see processingDeadline).
  const processingJobs = await prisma.topoJob.findMany({
    where: { status: "processing" },
    select: {
      id: true,
      startedAt: true,
      updatedAt: true,
      estimatedSeconds: true,
      ecsTaskArn: true,
    },
  });
  const overdueJobs = processingJobs.filter(
    (job) => processingDeadline(job, env.TOPO_REAPER_PROCESSING_TIMEOUT_MS) < now,
  );
  if (overdueJobs.length > 0) {
    const result = await prisma.topoJob.updateMany({
      // status kept in the WHERE: a job that completed between the read and
      // this write must not be flipped back to failed.
      where: { id: { in: overdueJobs.map((j) => j.id) }, status: "processing" },
      data: { status: "failed", errorMessage: REAPER_JOB_MESSAGE },
    });
    reaped += result.count;
    await stopTasksBestEffort(overdueJobs, "topo_job_reaper_stop_task_failed");
  }

  // topo_export_jobs · queued: anchored on createdAt.
  const exportQueuedCutoff = new Date(
    now.getTime() - env.TOPO_REAPER_EXPORT_QUEUED_TIMEOUT_MS,
  );
  const queuedExportResult = await prisma.topoExportJob.updateMany({
    where: { status: "queued", createdAt: { lt: exportQueuedCutoff } },
    data: { status: "failed", errorMessage: REAPER_EXPORT_MESSAGE },
  });
  reaped += queuedExportResult.count;

  // topo_export_jobs · running: anchored on startedAt (createdAt fallback).
  const exportRunningCutoff = new Date(
    now.getTime() - env.TOPO_REAPER_EXPORT_RUNNING_TIMEOUT_MS,
  );
  const overdueExports = await prisma.topoExportJob.findMany({
    where: {
      status: "running",
      OR: [
        { startedAt: { lt: exportRunningCutoff } },
        { startedAt: null, createdAt: { lt: exportRunningCutoff } },
      ],
    },
    select: { id: true, ecsTaskArn: true },
  });
  if (overdueExports.length > 0) {
    const result = await prisma.topoExportJob.updateMany({
      where: { id: { in: overdueExports.map((e) => e.id) }, status: "running" },
      data: { status: "failed", errorMessage: REAPER_EXPORT_MESSAGE },
    });
    reaped += result.count;
    await stopTasksBestEffort(
      overdueExports,
      "topo_export_reaper_stop_task_failed",
    );
  }

  // geo_pdf_jobs · queued: anchored on createdAt (mirrors topo_export_jobs).
  const geoPdfQueuedCutoff = new Date(
    now.getTime() - env.GEO_PDF_QUEUED_TIMEOUT_MS,
  );
  const queuedGeoPdfResult = await prisma.geoPdfJob.updateMany({
    where: { status: "queued", createdAt: { lt: geoPdfQueuedCutoff } },
    data: { status: "failed", errorMessage: REAPER_GEO_PDF_MESSAGE },
  });
  reaped += queuedGeoPdfResult.count;

  // geo_pdf_jobs · running: anchored on startedAt (createdAt fallback).
  const geoPdfRunningCutoff = new Date(
    now.getTime() - env.GEO_PDF_RUNNING_TIMEOUT_MS,
  );
  const overdueGeoPdfJobs = await prisma.geoPdfJob.findMany({
    where: {
      status: "running",
      OR: [
        { startedAt: { lt: geoPdfRunningCutoff } },
        { startedAt: null, createdAt: { lt: geoPdfRunningCutoff } },
      ],
    },
    select: { id: true, ecsTaskArn: true },
  });
  if (overdueGeoPdfJobs.length > 0) {
    const result = await prisma.geoPdfJob.updateMany({
      where: { id: { in: overdueGeoPdfJobs.map((j) => j.id) }, status: "running" },
      data: { status: "failed", errorMessage: REAPER_GEO_PDF_MESSAGE },
    });
    reaped += result.count;
    await stopTasksBestEffort(
      overdueGeoPdfJobs,
      "geo_pdf_reaper_stop_task_failed",
    );
  }

  return reaped;
}

/**
 * Export-expiry sweep (ARCH-006): completed exports older than
 * TOPO_EXPORT_TTL_MS (default 7 days, 0 disables) are removed — S3 object
 * first (idempotent: the bucket's `expire-exports` lifecycle rule, verified
 * 2026-06-11 as 7-day expiry on `exports/`, may have beaten us), then one
 * transaction decrementing the storage charge and deleting the row. This
 * makes the in-app accounting authoritative: rows stop presigning dead keys
 * and the quota is reclaimed when the bytes actually disappear, with the S3
 * rule kept as backstop. Returns the number of exports expired.
 *
 * Per-row failures are logged and skipped (the row simply survives to the
 * next sweep) so one bad row can't wedge the others.
 */
export async function expireCompletedExports(
  now: Date = new Date(),
): Promise<number> {
  const env = getEnv();
  if (env.TOPO_EXPORT_TTL_MS === 0) return 0;
  const bucket = env.S3_BUCKET_TOPO ?? "";

  const cutoff = new Date(now.getTime() - env.TOPO_EXPORT_TTL_MS);
  const expiredRows = await prisma.topoExportJob.findMany({
    where: { status: "completed", completedAt: { lt: cutoff } },
    select: { id: true, userId: true, resultKey: true, resultBytes: true },
  });

  let expired = 0;
  for (const row of expiredRows) {
    try {
      // S3 first (Design Q delete ordering): DeleteObject succeeds on a
      // missing key, so a lifecycle-rule head start is harmless; an S3
      // failure leaves the row for retry next sweep.
      if (row.resultKey) {
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: row.resultKey }),
        );
      }
      await prisma.$transaction(async (tx) => {
        await decrementStorageUsed(row.userId, row.resultBytes ?? 0n, tx);
        await tx.topoExportJob.delete({ where: { id: row.id } });
      });
      expired += 1;
    } catch (err) {
      logger.error({ err, id: row.id }, "topo_export_expiry_failed");
    }
  }
  return expired;
}

/**
 * GeoPdfJob expiry sweep — same shape as expireCompletedExports, reusing
 * TOPO_EXPORT_TTL_MS (0 disables). Completed jobs older than the cutoff are
 * removed: S3 object deleted, storage charge decremented, row removed in one
 * transaction. Per-row failures are logged and skipped so one bad row can't
 * wedge the others.
 */
export async function expireCompletedGeoPdfJobs(
  now: Date = new Date(),
): Promise<number> {
  const env = getEnv();
  if (env.TOPO_EXPORT_TTL_MS === 0) return 0;
  const bucket = env.S3_BUCKET_TOPO ?? "";

  const cutoff = new Date(now.getTime() - env.TOPO_EXPORT_TTL_MS);
  const expiredRows = await prisma.geoPdfJob.findMany({
    where: { status: "completed", completedAt: { lt: cutoff } },
    select: { id: true, userId: true, resultKey: true, resultBytes: true },
  });

  let expired = 0;
  for (const row of expiredRows) {
    try {
      if (row.resultKey) {
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: row.resultKey }),
        );
      }
      await prisma.$transaction(async (tx) => {
        await decrementStorageUsed(row.userId, row.resultBytes ?? 0n, tx);
        await tx.geoPdfJob.delete({ where: { id: row.id } });
      });
      expired += 1;
    } catch (err) {
      logger.error({ err, id: row.id }, "geo_pdf_expiry_failed");
    }
  }
  return expired;
}

type S3OutputKey = { name: string; cogKey: string | null; pmtilesKey: string | null };

/**
 * The layers a completed job can actually export, from its s3OutputKeys. A
 * raster layer needs a COG to export (the manual route rejects otherwise); a
 * vector layer exports from its stored GeoJSON, so presence is enough. Mirrors
 * the gate in routes/topoExports.ts so auto-export and manual export agree.
 */
export function exportableLayers(outputs: unknown): Set<TopoLayerKey> {
  const set = new Set<TopoLayerKey>();
  if (!Array.isArray(outputs)) return set;
  for (const raw of outputs as S3OutputKey[]) {
    const meta = TOPO_LAYERS.find((m) => m.name === raw?.name);
    if (!meta) continue;
    if (meta.format === "raster" && !raw.cogKey) continue;
    set.add(meta.name);
  }
  return set;
}

async function notifyAutoExportSkipped(
  userId: string,
  topoJobId: string,
  reason: string,
): Promise<void> {
  await prisma.notification.create({
    data: { userId, type: "topo_export_skipped", payload: { topoJobId, reason } },
  });
}

/**
 * Auto-export pass: for every completed topo job whose persisted auto-export
 * config is enabled and not yet handled, queue a TopoExportJob. The trigger for
 * the auto-export feature — the API owns ECS launching, so this runs here rather
 * than in the Python worker.
 *
 * Dedup is a status-guarded claim: `autoExportedAt` is flipped from null to now
 * in one updateMany, and only the sweep that flips exactly one row proceeds, so
 * overlapping sweeps / multiple API instances can never double-queue (same
 * idempotency rationale as the stuck-job sweeps above). A job that can't be
 * exported (config disabled/invalid, no exportable layers produced, cap hit, or
 * launch failure) is still claimed — we never retry — and the user is told via a
 * `topo_export_skipped` notification rather than failing silently.
 *
 * Returns the number of exports queued.
 */
export async function queueAutoExports(now: Date = new Date()): Promise<number> {
  const candidates = await prisma.topoJob.findMany({
    where: {
      status: "complete",
      autoExportedAt: null,
      autoExport: { path: ["enabled"], equals: true },
    },
    select: {
      id: true,
      userId: true,
      autoExport: true,
      s3OutputKeys: true,
      vectorStyleSnapshot: true,
    },
  });

  let queued = 0;
  for (const job of candidates) {
    try {
      // Claim first so a concurrent sweep can't also act on this job.
      const claim = await prisma.topoJob.updateMany({
        where: { id: job.id, autoExportedAt: null },
        data: { autoExportedAt: now },
      });
      if (claim.count !== 1) continue;

      const parsed = validateAutoExportSettings(job.autoExport);
      if (!parsed.ok || !parsed.value.enabled) continue; // claimed; nothing to do
      const cfg = parsed.value;

      const selection = reconcileExportSelection(
        { format: cfg.format, bundling: cfg.bundling, layers: cfg.layers },
        exportableLayers(job.s3OutputKeys),
      );
      const valid = validateExportRequest(selection);
      if (selection.layers.length === 0 || !valid.ok) {
        await notifyAutoExportSkipped(
          job.userId,
          job.id,
          valid.ok ? "none of the chosen layers were produced by this job" : valid.error,
        );
        continue;
      }

      try {
        await createAndLaunchTopoExport({
          userId: job.userId,
          sourceJobIds: [job.id],
          layers: selection.layers,
          format: selection.format,
          bundling: selection.bundling,
          vectorStyleSnapshot: (job.vectorStyleSnapshot as object | null) ?? VECTOR_STYLE_DEFAULTS,
        });
        queued += 1;
      } catch (err) {
        const reason =
          err instanceof AppError && err.statusCode === 429
            ? "too many exports are already in progress"
            : "the export could not be started";
        logger.error({ err, jobId: job.id }, "auto_export_launch_failed");
        await notifyAutoExportSkipped(job.userId, job.id, reason);
      }
    } catch (err) {
      // One bad job can't wedge the pass (matches expireCompletedExports).
      logger.error({ err, jobId: job.id }, "auto_export_pass_failed");
    }
  }
  return queued;
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
    queueAutoExports()
      .then((count) => {
        if (count > 0) logger.info({ count }, "topo_auto_exports_queued");
      })
      .catch((err) => {
        logger.error({ err }, "topo_auto_export_sweep_failed");
      });
    expireCompletedExports()
      .then((count) => {
        if (count > 0) logger.info({ count }, "topo_exports_expired");
      })
      .catch((err) => {
        logger.error({ err }, "topo_export_expiry_sweep_failed");
      });
    expireCompletedGeoPdfJobs()
      .then((count) => {
        if (count > 0) logger.info({ count }, "geo_pdf_jobs_expired");
      })
      .catch((err) => {
        logger.error({ err }, "geo_pdf_expiry_sweep_failed");
      });
    sweepOrphanedMediaUploads().catch((err) => {
      logger.error({ err }, "media_orphan_sweep_failed");
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
      exportQueuedTimeoutMs: env.TOPO_REAPER_EXPORT_QUEUED_TIMEOUT_MS,
      exportRunningTimeoutMs: env.TOPO_REAPER_EXPORT_RUNNING_TIMEOUT_MS,
      exportTtlMs: env.TOPO_EXPORT_TTL_MS,
      geoPdfQueuedTimeoutMs: env.GEO_PDF_QUEUED_TIMEOUT_MS,
      geoPdfRunningTimeoutMs: env.GEO_PDF_RUNNING_TIMEOUT_MS,
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
