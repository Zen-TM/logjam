import { StopTaskCommand } from "@aws-sdk/client-ecs";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import prisma from "../services/prisma";
import { sendPushToUser, type PushData } from "../services/push";
import { sendEmail } from "../services/email";
import { ecs, s3 } from "../services/awsClients";
import { decrementStorageUsed } from "./storageQuota";
import { sweepOrphanedMediaUploads } from "./mediaOrphanSweeper";
import { sweepExpiredFileSends } from "./fileSendReaper";
import { createAndLaunchTopoExport } from "./topoExportLauncher";
import { AppError } from "../middleware/errorHandler";
import {
  TOPO_LAYERS,
  VECTOR_STYLE_DEFAULTS,
  normalizeUserUiPreferences,
  reconcileExportSelection,
  validateAutoExportSettings,
  validateExportRequest,
  type TopoLayerKey,
} from "@logjam/shared";
import { getEnv } from "./env";
import { logger, safeErrorForLog } from "./logger";
import { deleteSharesFor } from "./shareAccess";

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
//   topo_jobs · processing       — stalled OR past ceiling (isProcessingDead
//       below): the worker heartbeats lastProgressAt through the long PDAL +
//       render phases, so a job is reaped only when progress stalls for
//       TOPO_REAPER_PROGRESS_STALL_MS, or it blows the absolute ceiling
//       (max(timeout, 2× estimate)). A slow-but-advancing render — the
//       multi-hour large-job case — is never reaped mid-run (ARCH-001).
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

// A `processing` topo job is reaped when it STALLS (no render/PDAL progress for
// a while) OR blows an absolute ceiling. The stall check is the primary signal:
// the worker heartbeats `lastProgressAt` through the long PDAL + render phases,
// so a slow-but-advancing job (e.g. a multi-hour large render) is never killed,
// while a genuinely hung job dies promptly. The ceiling is a backstop for a job
// that keeps emitting progress but never finishes.

/**
 * Stall deadline (pure — prime unit-test target): the job is stale if no
 * progress has been reported for `stallMs`. Anchored on lastProgressAt (the
 * heartbeat), falling back to startedAt before the first heartbeat tick, then
 * updatedAt for rows that predate the columns.
 */
export function progressStallDeadline(
  job: {
    startedAt: Date | null;
    updatedAt: Date;
    lastProgressAt: Date | null;
  },
  stallMs: number,
): Date {
  const anchor = job.lastProgressAt ?? job.startedAt ?? job.updatedAt;
  return new Date(anchor.getTime() + stallMs);
}

/**
 * Absolute ceiling (pure): catches a job that keeps emitting progress but never
 * finishes (pathological hang/loop). Anchored on startedAt. The budget is the
 * ceiling timeout or twice the API's own estimate, whichever is larger.
 */
export function absoluteProcessingDeadline(
  job: {
    startedAt: Date | null;
    updatedAt: Date;
    estimatedSeconds: number | null;
  },
  ceilingMs: number,
): Date {
  const anchor = job.startedAt ?? job.updatedAt;
  const budgetMs = Math.max(
    ceilingMs,
    job.estimatedSeconds !== null
      ? ESTIMATE_SAFETY_FACTOR * job.estimatedSeconds * 1000
      : 0,
  );
  return new Date(anchor.getTime() + budgetMs);
}

/** True when a `processing` job should be force-failed: stalled OR past ceiling. */
export function isProcessingDead(
  job: {
    startedAt: Date | null;
    updatedAt: Date;
    lastProgressAt: Date | null;
    estimatedSeconds: number | null;
  },
  now: Date,
  stallMs: number,
  ceilingMs: number,
): boolean {
  return (
    progressStallDeadline(job, stallMs).getTime() < now.getTime() ||
    absoluteProcessingDeadline(job, ceilingMs).getTime() < now.getTime()
  );
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
      logger.warn({ err: safeErrorForLog(err), id: row.id }, event);
    }
  }
}

/**
 * A reaped job is a FAILED job the user was never told about (APIC-005): the
 * workers' own except paths write a Notification + push (+ email), the reaper
 * used to write only `status`/`errorMessage`, so a user whose task was never
 * placed or was SIGKILLed found out by polling the list.
 *
 * Best-effort by design: notification/push/email failure must never abort a
 * sweep that has already done its real work (the status flip).
 */
type ReapEntry = {
  userId: string;
  type: string;
  payload: Prisma.InputJsonValue;
  push: PushData;
  /**
   * Failure email, gated on the pipeline's EXISTING preference — `topoEmail` /
   * `exportEmail` / `geoPdfEmail` mean "finishes or fails", so a reaped job
   * mails the same users a worker-detected failure would (no new pref key).
   * `reason` is the generic REAPER_* message: the reaper never knows more.
   */
  email: {
    pref: "topoEmail" | "exportEmail" | "geoPdfEmail";
    subject: string;
    headline: string;
    reason: string;
    /** Query string for the FRONTEND_URL deep link, e.g. `topoJob=<id>`. */
    deepLink: string;
  };
};

/**
 * Best-effort failure email per reaped row. Same shape as the workers' own
 * failure mail (geoPdfWorker.ts / export_worker.py): logo header, one-line
 * reason, FRONTEND_URL deep link — a reaped-job email must not read as a
 * different species from a worker-sent one.
 *
 * One user read for the whole batch; `sendEmail` swallows its own send
 * failures, and the caller wraps this so a user-lookup failure can't abort a
 * sweep either.
 */
async function emailReaped(entries: ReapEntry[]): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: { id: { in: [...new Set(entries.map((entry) => entry.userId))] } },
    select: { id: true, email: true, uiPreferences: true },
  });
  const byId = new Map(recipients.map((row) => [row.id, row]));
  const base = (getEnv().FRONTEND_URL ?? "").replace(/\/$/, "");
  // Logo lives in the frontend SPA bucket, so it only resolves when
  // FRONTEND_URL is configured (unset in local dev).
  const logoHtml = base
    ? `<p style="margin:0 0 16px"><img src="${base}/email-logo-lockup.png" alt="Logjam" width="212" style="display:block" /></p>`
    : "";
  for (const entry of entries) {
    const recipient = byId.get(entry.userId);
    if (!recipient?.email) continue;
    const wanted = normalizeUserUiPreferences(recipient.uiPreferences).notifications;
    if (!wanted[entry.email.pref]) continue;
    const openUrl = base ? `${base}/?${entry.email.deepLink}` : "";
    const openLink = openUrl ? `\n\nOpen Logjam: ${openUrl}` : "";
    const openLinkHtml = openUrl ? `<p><a href="${openUrl}">Open Logjam</a></p>` : "";
    await sendEmail({
      to: recipient.email,
      subject: entry.email.subject,
      text: `${entry.email.headline}\n\n${entry.email.reason}${openLink}`,
      html: `${logoHtml}<p>${entry.email.headline}</p><p><strong>${entry.email.reason}</strong></p>${openLinkHtml}`,
    });
  }
}

async function notifyReaped(entries: ReapEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: entries.map(({ userId, type, payload }) => ({ userId, type, payload })),
    });
  } catch (err) {
    logger.error({ err: safeErrorForLog(err) }, "reaper_notification_write_failed");
    return;
  }
  for (const entry of entries) {
    // sendPushToUser swallows its own failures; the try is belt-and-braces.
    try {
      await sendPushToUser(entry.userId, entry.push);
    } catch (err) {
      logger.warn({ err: safeErrorForLog(err) }, "reaper_push_failed");
    }
  }
  try {
    await emailReaped(entries);
  } catch (err) {
    logger.error({ err: safeErrorForLog(err) }, "reaper_email_failed");
  }
}

/**
 * Flip overdue rows to failed ONE AT A TIME and notify only the rows this pass
 * actually claimed.
 *
 * The status-guarded claim is the house dedup rule (root CLAUDE.md; same shape
 * as `queueAutoExports`'s `autoExportedAt` marker): two API instances sweeping
 * concurrently both read the same overdue ids, but only one `updateMany` per id
 * reports `count === 1`. Notifying on the READ set instead would send the user
 * two notifications, two pushes and two emails per reaped job — prod runs the
 * API on Elastic Beanstalk, so >1 instance is a real configuration.
 *
 * Winning the flip also proves the row was still `pending`/`queued`/overdue a
 * moment ago, which is why no confirm-read is needed.
 *
 * ponytail: one UPDATE per row — a sweep handles a handful of stuck rows, so
 * the round-trips are noise. If a pass ever reaps thousands, claim in batches
 * with a per-pass marker column instead.
 */
async function claimAndNotify<Row extends { id: string }>(
  rows: Row[],
  claimOne: (id: string) => Promise<{ count: number }>,
  entryFor: (row: Row) => ReapEntry,
): Promise<number> {
  const claimedRows: Row[] = [];
  for (const row of rows) {
    const claim = await claimOne(row.id);
    if (claim.count === 1) claimedRows.push(row);
  }
  await notifyReaped(claimedRows.map(entryFor));
  return claimedRows.length;
}

/** Same type + payload shape topo/worker.py's failure path writes. */
function topoJobEntry(row: { id: string; userId: string; name: string | null }): ReapEntry {
  return {
    userId: row.userId,
    type: "topo_failed",
    payload: { jobId: row.id, jobName: row.name },
    push: { type: "topo_failed", jobId: row.id },
    email: {
      pref: "topoEmail",
      // Mirrors worker.py's "Topo map ready — Logjam".
      subject: "Topo map failed — Logjam",
      headline: "Your topo map job failed.",
      reason: REAPER_JOB_MESSAGE,
      deepLink: `topoJob=${row.id}`,
    },
  };
}

/** Mirrors topo/export_worker.py's failure notification. */
function exportJobEntry(row: { id: string; userId: string; format: string }): ReapEntry {
  return {
    userId: row.userId,
    type: "topo_export_complete",
    payload: {
      exportJobId: row.id,
      format: row.format,
      status: "failed",
      errorMessage: REAPER_EXPORT_MESSAGE,
    },
    push: { type: "topo_export_complete", exportId: row.id },
    email: {
      pref: "exportEmail",
      // Same subject export_worker.py's failure mail uses.
      subject: `Topo export failed — ${row.format.toUpperCase()}`,
      headline: "Your topo export failed.",
      reason: REAPER_EXPORT_MESSAGE,
      deepLink: `export=${row.id}`,
    },
  };
}

/** Mirrors worker/geoPdfWorker.ts's failure notification + push type. */
function geoPdfJobEntry(row: { id: string; userId: string }): ReapEntry {
  return {
    userId: row.userId,
    type: "geo_pdf_complete",
    payload: {
      geoPdfJobId: row.id,
      status: "failed",
      errorMessage: REAPER_GEO_PDF_MESSAGE,
    },
    push: { type: "geo_pdf_failed", geoPdfJobId: row.id },
    email: {
      pref: "geoPdfEmail",
      // Same subject geoPdfWorker.ts's failure mail uses.
      subject: "GeoPDF failed — Logjam",
      headline: "Your GeoPDF could not be generated.",
      reason: REAPER_GEO_PDF_MESSAGE,
      deepLink: `geoPdfJob=${row.id}`,
    },
  };
}

/**
 * One reaper pass over both job tables. Returns the number of rows THIS pass
 * claimed (see claimAndNotify — an overlapping instance's rows don't count).
 * Throws on DB error (fail loud — the caller logs). Every flip is a per-row
 * status-guarded claim, so a row that reaches a terminal state between read and
 * write is left untouched and its owner is never told it failed.
 */
export async function reapStuckTopoJobs(now: Date = new Date()): Promise<number> {
  const env = getEnv();
  let reaped = 0;

  // topo_jobs · pending: anchored on updatedAt (set when /start flipped it).
  const pendingCutoff = new Date(now.getTime() - env.TOPO_REAPER_PENDING_TIMEOUT_MS);
  // Read the rows first: an updateMany reports a count, leaving nobody to tell.
  const pendingJobs = await prisma.topoJob.findMany({
    where: { status: "pending", updatedAt: { lt: pendingCutoff } },
    select: { id: true, userId: true, name: true },
  });
  reaped += await claimAndNotify(
    pendingJobs,
    (id) =>
      prisma.topoJob.updateMany({
        where: { id, status: "pending" },
        data: { status: "failed", errorMessage: REAPER_JOB_MESSAGE },
      }),
    topoJobEntry,
  );

  // topo_jobs · processing: reaped only when stalled or past the absolute
  // ceiling (see isProcessingDead). lastProgressAt is the heartbeat anchor, so a
  // slow-but-advancing job is never force-failed.
  const processingJobs = await prisma.topoJob.findMany({
    where: { status: "processing" },
    select: {
      id: true,
      userId: true,
      name: true,
      startedAt: true,
      updatedAt: true,
      lastProgressAt: true,
      estimatedSeconds: true,
      ecsTaskArn: true,
    },
  });
  const overdueJobs = processingJobs.filter((job) =>
    isProcessingDead(
      job,
      now,
      env.TOPO_REAPER_PROGRESS_STALL_MS,
      env.TOPO_REAPER_PROCESSING_TIMEOUT_MS,
    ),
  );
  if (overdueJobs.length > 0) {
    reaped += await claimAndNotify(
      overdueJobs,
      // status kept in the WHERE: a job that completed between the read and
      // this write must not be flipped back to failed.
      (id) =>
        prisma.topoJob.updateMany({
          where: { id, status: "processing" },
          data: { status: "failed", errorMessage: REAPER_JOB_MESSAGE },
        }),
      topoJobEntry,
    );
    // Best-effort even for rows another instance claimed: the task is dead
    // either way, and StopTask on an already-stopped task is a no-op.
    await stopTasksBestEffort(overdueJobs, "topo_job_reaper_stop_task_failed");
  }

  // topo_export_jobs · queued: anchored on createdAt.
  const exportQueuedCutoff = new Date(
    now.getTime() - env.TOPO_REAPER_EXPORT_QUEUED_TIMEOUT_MS,
  );
  const queuedExports = await prisma.topoExportJob.findMany({
    where: { status: "queued", createdAt: { lt: exportQueuedCutoff } },
    select: { id: true, userId: true, format: true },
  });
  reaped += await claimAndNotify(
    queuedExports,
    (id) =>
      prisma.topoExportJob.updateMany({
        where: { id, status: "queued" },
        data: { status: "failed", errorMessage: REAPER_EXPORT_MESSAGE },
      }),
    exportJobEntry,
  );

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
    select: { id: true, userId: true, format: true, ecsTaskArn: true },
  });
  if (overdueExports.length > 0) {
    reaped += await claimAndNotify(
      overdueExports,
      (id) =>
        prisma.topoExportJob.updateMany({
          where: { id, status: "running" },
          data: { status: "failed", errorMessage: REAPER_EXPORT_MESSAGE },
        }),
      exportJobEntry,
    );
    await stopTasksBestEffort(
      overdueExports,
      "topo_export_reaper_stop_task_failed",
    );
  }

  // geo_pdf_jobs · queued: anchored on createdAt (mirrors topo_export_jobs).
  const geoPdfQueuedCutoff = new Date(
    now.getTime() - env.GEO_PDF_QUEUED_TIMEOUT_MS,
  );
  const queuedGeoPdfJobs = await prisma.geoPdfJob.findMany({
    where: { status: "queued", createdAt: { lt: geoPdfQueuedCutoff } },
    select: { id: true, userId: true },
  });
  reaped += await claimAndNotify(
    queuedGeoPdfJobs,
    (id) =>
      prisma.geoPdfJob.updateMany({
        where: { id, status: "queued" },
        data: { status: "failed", errorMessage: REAPER_GEO_PDF_MESSAGE },
      }),
    geoPdfJobEntry,
  );

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
    select: { id: true, userId: true, ecsTaskArn: true },
  });
  if (overdueGeoPdfJobs.length > 0) {
    reaped += await claimAndNotify(
      overdueGeoPdfJobs,
      (id) =>
        prisma.geoPdfJob.updateMany({
          where: { id, status: "running" },
          data: { status: "failed", errorMessage: REAPER_GEO_PDF_MESSAGE },
        }),
      geoPdfJobEntry,
    );
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
      logger.error({ err: safeErrorForLog(err), id: row.id }, "topo_export_expiry_failed");
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
        // Same transaction as the row delete: Share.entityId is polymorphic, so
        // Postgres cannot cascade — without this the rows outlive the job and
        // keep the recipient's notification resolvable to a dead id.
        await deleteSharesFor(tx, "geoPdfJob", [row.id]);
        await tx.geoPdfJob.delete({ where: { id: row.id } });
      });
      expired += 1;
    } catch (err) {
      // Scrub before logging: an S3/Prisma error can embed the result key, and
      // the result key can name a canyon (root privacy rule).
      logger.error(
        { ...safeErrorForLog(err), id: row.id },
        "geo_pdf_expiry_failed",
      );
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
  // Best-effort push — generic title + opaque IDs only (the skip reason
  // stays in the in-app notification, never in the push).
  await sendPushToUser(userId, { type: "topo_export_skipped", jobId: topoJobId });
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
      footprint: true,
      tileCount: true,
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

      // A footprint-less job (legacy / failed-but-marked-complete) crashes the
      // export worker at render_composite_*. Skip with a notification; the claim
      // above keeps it from being retried each sweep.
      if (job.footprint === null) {
        await notifyAutoExportSkipped(
          job.userId,
          job.id,
          "the source job is missing its footprint — re-run it",
        );
        continue;
      }

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
          sourceTileCount: job.tileCount ?? null,
        });
        queued += 1;
      } catch (err) {
        const reason =
          err instanceof AppError && err.statusCode === 429
            ? "too many exports are already in progress"
            : "the export could not be started";
        logger.error({ err: safeErrorForLog(err), jobId: job.id }, "auto_export_launch_failed");
        await notifyAutoExportSkipped(job.userId, job.id, reason);
      }
    } catch (err) {
      // One bad job can't wedge the pass (matches expireCompletedExports).
      logger.error({ err: safeErrorForLog(err), jobId: job.id }, "auto_export_pass_failed");
    }
  }
  return queued;
}

/**
 * Sweep sync tombstones (Stage 8) older than SYNC_TOMBSTONE_TTL_MS. Safe to
 * run concurrently (deleteMany on a time cutoff is idempotent). A delta client
 * whose cursor predates the horizon gets resetRequired from /sync/delta, so
 * sweeping bounds table growth without correctness risk. 0 = never sweep.
 */
export async function sweepSyncTombstones(
  now: Date = new Date(),
): Promise<number> {
  const ttl = getEnv().SYNC_TOMBSTONE_TTL_MS;
  if (ttl === 0) return 0;
  const cutoff = new Date(now.getTime() - ttl);
  const { count } = await prisma.syncTombstone.deleteMany({
    where: { deletedAt: { lt: cutoff } },
  });
  return count;
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
        logger.error({ err: safeErrorForLog(err) }, "topo_job_reaper_failed");
      });
    queueAutoExports()
      .then((count) => {
        if (count > 0) logger.info({ count }, "topo_auto_exports_queued");
      })
      .catch((err) => {
        logger.error({ err: safeErrorForLog(err) }, "topo_auto_export_sweep_failed");
      });
    expireCompletedExports()
      .then((count) => {
        if (count > 0) logger.info({ count }, "topo_exports_expired");
      })
      .catch((err) => {
        logger.error({ err: safeErrorForLog(err) }, "topo_export_expiry_sweep_failed");
      });
    expireCompletedGeoPdfJobs()
      .then((count) => {
        if (count > 0) logger.info({ count }, "geo_pdf_jobs_expired");
      })
      .catch((err) => {
        logger.error({ err: safeErrorForLog(err) }, "geo_pdf_expiry_sweep_failed");
      });
    sweepOrphanedMediaUploads().catch((err) => {
      logger.error({ err: safeErrorForLog(err) }, "media_orphan_sweep_failed");
    });
    sweepSyncTombstones()
      .then((count) => {
        if (count > 0) logger.info({ count }, "sync_tombstones_swept");
      })
      .catch((err) => {
        logger.error({ err: safeErrorForLog(err) }, "sync_tombstone_sweep_failed");
      });
    sweepExpiredFileSends()
      .then((count) => {
        if (count > 0) logger.info({ count }, "file_sends_expired");
      })
      .catch((err) => {
        logger.error({ err: safeErrorForLog(err) }, "file_send_sweep_failed");
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
