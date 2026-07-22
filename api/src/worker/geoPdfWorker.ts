// geoPdfWorker.ts
// -----------------
// ECS Fargate worker. Processes a single GeoPdfJob then exits. Mirrors
// topo/export_worker.py's claim/render/terminal-write lifecycle (Design L1):
//
//   1. Claim: queued → running, guarded (`WHERE status = 'queued'`), with
//      started_at set. 0 rows updated = reaped or duplicate launch — exit 0.
//   2. Render the PDF via the existing generateGeoPdf service (unchanged).
//   3. Upload to s3://S3_BUCKET_TOPO/exports/geo-pdf/{jobId}/logjam-export.pdf.
//   4. Terminal write guarded on `running`: completed (with the storage charge
//      in the SAME transaction, ARCH-003) or failed. 0 rows updated = reaped
//      mid-run — delete the uploaded object and exit 0.
//   5. Notification row (+ optional SES email — TODO, see below).
//
// Required env: GEO_PDF_JOB_ID, DB_HOST/DB_PORT/DB_NAME (ECS-injected
// DB_USER/DB_PASSWORD), S3_BUCKET_TOPO (via getEnv()).

import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../services/awsClients";
import prisma from "../services/prisma";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";
import { sendPushToUser } from "../services/push";
import { generateGeoPdf } from "../services/generateGeoPdf";
import { sendEmail } from "../services/email";
import type { GeoPdfConfig, VectorStyleSettings } from "@logjam/shared";
import {
  validateGeoPdfConfig,
  validateVectorStyleSettings,
  VECTOR_STYLE_DEFAULTS,
  normalizeUserUiPreferences,
} from "@logjam/shared";

const GENERIC_FAILURE_MESSAGE =
  "GeoPDF generation failed. Submit a new job to retry.";

/** Build the S3 key for a job's rendered PDF. Pure (unit-test target). */
export function resultKeyFor(jobId: string): string {
  return `exports/geo-pdf/${jobId}/logjam-export.pdf`;
}

/**
 * Parse and validate a stored GeoPdfJob.config blob. Throws if the stored
 * config fails the same allowlist validation enforced at submission time —
 * this should never happen for a row this worker created, but a stored-data
 * integrity issue must fail loudly rather than render an unvalidated config.
 */
export function parseStoredConfig(config: unknown): GeoPdfConfig {
  const error = validateGeoPdfConfig(config);
  if (error) {
    throw new Error(`Stored GeoPdfJob config failed validation: ${error}`);
  }
  return config as GeoPdfConfig;
}

/**
 * Parse a stored vector-style snapshot, falling back to defaults on invalid
 * stored JSON (mirrors the GET /vector-style fallback) — not a fatal error,
 * just a degraded render.
 */
export function parseStoredVectorStyle(snapshot: unknown): VectorStyleSettings {
  if (snapshot == null) return VECTOR_STYLE_DEFAULTS;
  const result = validateVectorStyleSettings(snapshot);
  if (result.ok) return result.value;
  logger.warn(
    { errors: result.errors },
    "geo_pdf_worker_invalid_vector_style_snapshot",
  );
  return VECTOR_STYLE_DEFAULTS;
}

/**
 * Process a single GeoPdfJob end-to-end: claim (queued→running) → render →
 * upload → terminal write (+ storage charge in the same transaction) → notify.
 * Returns 0 on success or a clean no-op (job reaped / not `queued` / missing),
 * 1 on render failure. Called by the CLI worker entrypoint below (the ECS
 * Fargate task) — all lifecycle invariants (Design L1, ARCH-003, privacy rule)
 * live here, not in the wrapper.
 */
export async function processGeoPdfJob(jobId: string): Promise<number> {
  const env = getEnv();
  const bucket = env.S3_BUCKET_TOPO ?? "";

  const job = await prisma.geoPdfJob.findUnique({ where: { id: jobId } });
  if (!job) {
    logger.error({ jobId }, "geo_pdf_worker_job_not_found");
    return 1;
  }

  // Guarded on `queued` (Design L1): if the job was reaped or deleted while
  // the task spun up, claim nothing and exit cleanly. started_at anchors the
  // reaper's running-timeout (mirrors topo_export_jobs.started_at).
  const claim = await prisma.geoPdfJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: { status: "running", startedAt: new Date() },
  });
  if (claim.count === 0) {
    logger.warn({ jobId }, "geo_pdf_worker_not_queued_exiting");
    return 0;
  }

  let errorMessage: string | null = null;
  let resultKey: string | null = null;
  let resultBytes: number | null = null;

  try {
    const config = parseStoredConfig(job.config);
    const vectorStyle = parseStoredVectorStyle(job.vectorStyleSnapshot);

    const pdfBuffer = await generateGeoPdf(config, job.userId, vectorStyle);

    const key = resultKeyFor(jobId);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      }),
    );
    resultKey = key;
    resultBytes = pdfBuffer.length;
  } catch (err) {
    // Keep the raw exception (which may reference tile URLs / extents) out of
    // the user-facing/stored error message — log only the error class, never
    // canyon coords/names (CLAUDE.md privacy rule).
    logger.error(
      { jobId, errClass: err instanceof Error ? err.constructor.name : typeof err },
      "geo_pdf_worker_render_failed",
    );
    errorMessage = GENERIC_FAILURE_MESSAGE;
  }

  // Terminal write guarded on `running` (Design L1). On success the storage
  // charge shares the same transaction as the status flip (ARCH-003) — never
  // a separate commit.
  let updated: number;
  let ok: boolean;
  if (errorMessage || resultKey === null) {
    const result = await prisma.geoPdfJob.updateMany({
      where: { id: jobId, status: "running" },
      data: {
        status: "failed",
        errorMessage: errorMessage ?? GENERIC_FAILURE_MESSAGE,
        completedAt: new Date(),
      },
    });
    updated = result.count;
    ok = false;
  } else {
    updated = await prisma.$transaction(async (tx) => {
      const result = await tx.geoPdfJob.updateMany({
        where: { id: jobId, status: "running" },
        data: {
          status: "completed",
          resultKey,
          resultBytes: BigInt(resultBytes!),
          completedAt: new Date(),
        },
      });
      if (result.count > 0) {
        await tx.user.update({
          where: { id: job.userId },
          data: { storageUsedBytes: { increment: BigInt(resultBytes!) } },
        });
      }
      return result.count;
    });
    ok = true;
  }

  if (updated === 0) {
    // Job was reaped or deleted mid-render: nothing references the uploaded
    // PDF and no storage was charged — self-clean and skip
    // notification/email. Exit 0 either way (the outcome is moot).
    logger.warn({ jobId }, "geo_pdf_worker_reaped_mid_run_cleaning_up");
    if (resultKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: resultKey }));
    }
    return 0;
  }

  await prisma.notification.create({
    data: {
      userId: job.userId,
      type: "geo_pdf_complete",
      payload: {
        geoPdfJobId: jobId,
        status: ok ? "completed" : "failed",
        errorMessage: ok ? null : (errorMessage ?? GENERIC_FAILURE_MESSAGE),
      },
    },
  });

  // Best-effort push, mirroring email — generic title + opaque IDs only.
  await sendPushToUser(job.userId, { type: "geo_pdf_complete", geoPdfJobId: jobId });

  // Best-effort completion email (Resend), mirroring the Python workers'
  // send_completion_email. Gated on the user's geoPdfEmail preference (default
  // true). The in-app notification above is the source of truth — a missing
  // email/pref or send failure never affects the job outcome.
  const recipient = await prisma.user.findUnique({
    where: { id: job.userId },
    select: { email: true, uiPreferences: true },
  });
  const wantsEmail =
    normalizeUserUiPreferences(recipient?.uiPreferences).notifications.geoPdfEmail;
  if (recipient?.email && wantsEmail) {
    const base = (env.FRONTEND_URL ?? "").replace(/\/$/, "");
    const openUrl = base ? `${base}/?geoPdfJob=${jobId}` : "";
    const openLink = openUrl ? `\n\nOpen Logjam: ${openUrl}` : "";
    const openLinkHtml = openUrl
      ? `<p><a href="${openUrl}">Open Logjam</a></p>`
      : "";
    // Logo header is served by the frontend SPA bucket, so it only resolves
    // when FRONTEND_URL is configured (unset in local dev).
    const logoHtml = base
      ? `<p style="margin:0 0 16px"><img src="${base}/email-logo-lockup.png" alt="Logjam" width="212" style="display:block" /></p>`
      : "";
    const subject = ok ? "GeoPDF ready — Logjam" : "GeoPDF failed — Logjam";
    const text = ok
      ? `Your GeoPDF is ready to download.${openLink}`
      : `Your GeoPDF could not be generated.\n\n${errorMessage ?? GENERIC_FAILURE_MESSAGE}${openLink}`;
    const html = ok
      ? `${logoHtml}<p>Your GeoPDF is ready to download.</p>${openLinkHtml}`
      : `${logoHtml}<p>Your GeoPDF could not be generated.</p><p><strong>${errorMessage ?? GENERIC_FAILURE_MESSAGE}</strong></p>${openLinkHtml}`;
    await sendEmail({ to: recipient.email, subject, text, html });
  }

  return ok ? 0 : 1;
}

// CLI entrypoint: read the job ID from the env var the (legacy Fargate) launch
// path and `make geo-pdf-run` pass, then delegate to the shared processor.
async function main(): Promise<number> {
  const jobId = process.env.GEO_PDF_JOB_ID;
  if (!jobId) {
    logger.error("geo_pdf_worker_missing_job_id");
    return 1;
  }
  return processGeoPdfJob(jobId);
}

// Only run main() when executed directly (node dist/worker/geoPdfWorker.js),
// not when imported — lets unit tests import the pure helpers above (and a
// future test of main()'s orchestration) without triggering process.exit.
if (require.main === module) {
  main()
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (err) => {
      logger.error({ err }, "geo_pdf_worker_unhandled_error");
      await prisma.$disconnect();
      process.exit(1);
    });
}
