// Async GeoPDF generation pipeline (mirrors topoExports.ts).
//
// GeoPDF generation fetches many map tiles over HTTP and renders onto a
// server-side canvas — up to ~120 s of CPU + network fan-out. That used to run
// SYNCHRONOUSLY in this request handler, bounded only by an in-process
// concurrency cap (MAX_CONCURRENT_GEO_PDF). This now follows the same
// async-job/ECS-worker pattern as the on-demand topo export pipeline: the
// server snapshots the live vector style, persists a GeoPdfJob row, and
// launches an ECS task (logjam-geo-pdf-worker /
// api/src/worker/geoPdfWorker.ts) that renders the PDF, uploads it to S3, and
// notifies the user when ready.

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../services/awsClients";
import { logger, safeErrorForLog } from "../lib/logger";
import type {
  GeoPdfConfig,
  VectorStyleSettings,
  GeoPdfJobStatus,
  GeoPdfJobView,
} from "@logjam/shared";
import {
  validateVectorStyleSettings,
  VECTOR_STYLE_DEFAULTS,
  validateGeoPdfConfig,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { getParam } from "../lib/getParam";
import { geoPdfTitle } from "../lib/geoPdfTitle";
import { launchFargateTask } from "../lib/ecsRunTask";
import { assertHasStorageQuota } from "../lib/storageQuota";
import { assertHasEgressQuota } from "../lib/egressQuota";
import { Prisma } from "@prisma/client";
import { resolveUser as getUser } from "../lib/resolveUser";
import {
  deleteSharesFor,
  directlySharedIds,
  getJobRole,
  requireShareAccess,
  requireShareOwner,
} from "../lib/shareAccess";
import { estimateGeoPdfSeconds } from "../lib/runtimeEstimates";
import { assertHasCredits } from "../lib/computeCredits";
import { assertGlobalCapacity } from "../lib/fargateCapacity";

const router = Router();

const env = getEnv();
const TOPO_BUCKET = env.S3_BUCKET_TOPO ?? "";
const ECS_GEO_PDF_TASK_DEF = env.ECS_GEO_PDF_TASK_DEF;
// Non-empty subnet list = launch the worker via RunTask. Local dev sets dummy
// subnets (.env.local) so MiniStack spawns the worker container; an empty list
// disables the launch and leaves the job queued.
const ECS_SUBNETS = env.ECS_SUBNETS_LIST;

// Cap to prevent users from flooding ECS with queued GeoPDF jobs. Mirrors the
// per-user in-flight cap pattern in topoExports.ts, but tighter — GeoPDF jobs
// are typically much shorter than topo exports.
const MAX_IN_FLIGHT_PER_USER = 2;
const PRESIGN_TTL_SECONDS = 86400; // 24h

// Server-side cap on the GeoPDF list. X-Total-Count carries the true total so
// the client can show a truncation caption when this cap bites (UX-002).
const GEO_PDF_LIST_CAP = 50;

// Derive a human download filename from the job's title, falling back to a
// date-stamped name. The stored S3 key stays the generic logjam-export.pdf
// (worker contract); only the presented download name is overridden, via the
// presigned URL's ResponseContentDisposition. Sanitised to a conservative
// ASCII-safe set so no RFC 5987 encoding is needed.
function geoPdfDownloadFilename(config: unknown, createdAt: Date): string {
  const title = geoPdfTitle(config);
  const base =
    title !== null
      ? title
      : `logjam-geopdf-${createdAt.toISOString().slice(0, 10)}`;
  const safe =
    base
      .replace(/[^a-zA-Z0-9 _-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "logjam-geopdf";
  return `${safe}.pdf`;
}

async function presignResult(
  resultKey: string | null,
  filename?: string,
): Promise<{ url: string; expiresAt: string } | null> {
  if (!resultKey) return null;
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: TOPO_BUCKET,
      Key: resultKey,
      ...(filename
        ? { ResponseContentDisposition: `attachment; filename="${filename}"` }
        : {}),
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
  const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString();
  return { url, expiresAt };
}

function rowToView(
  row: {
    id: string;
    userId: string;
    status: string;
    config: unknown;
    estimatedSeconds: number | null;
    resultBytes: bigint | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
  },
  download: { url: string; expiresAt: string } | null,
  callerId: string,
): GeoPdfJobView {
  return {
    id: row.id,
    status: row.status as GeoPdfJobStatus,
    title: geoPdfTitle(row.config),
    estimatedSeconds: row.estimatedSeconds,
    resultBytes: row.resultBytes !== null ? Number(row.resultBytes) : null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    syncRole: row.userId === callerId ? "owner" : "shared",
    downloadUrl: download?.url ?? null,
    downloadExpiresAt: download?.expiresAt ?? null,
  };
}

// POST /geo-pdf — submit a new GeoPDF generation job
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);

    // Entry gate (ARCH-012): every byte-producing flow checks storage quota at
    // submission. The worker charges result_bytes unconditionally on
    // completion, so without this an over-quota user could keep accruing.
    await assertHasStorageQuota(user.id);

    const config = req.body as GeoPdfConfig;
    const configError = validateGeoPdfConfig(config);
    if (configError) {
      throw new AppError(400, configError);
    }
    // GEOPDF-1: the shared validator enforces numbers + N>S/E>W but not
    // coordinate ranges — reject out-of-range extents here so a worker task
    // can never be burned rendering a nonsense region.
    const { north, south, east, west } = config.extent;
    if (north > 90 || south < -90 || east > 180 || west < -180) {
      throw new AppError(
        400,
        "Invalid extent: latitudes must be within -90..90 and longitudes within -180..180",
      );
    }

    // null = new user with no saved style → defaults (same as GET /vector-style
    // and the overlay fallback). Invalid stored JSON → warn + defaults.
    let vectorStyle: VectorStyleSettings = VECTOR_STYLE_DEFAULTS;
    if (user.vectorStyle != null) {
      const result = validateVectorStyleSettings(user.vectorStyle);
      if (result.ok) {
        vectorStyle = result.value;
      } else {
        logger.warn(
          { errors: result.errors },
          "geo_pdf_invalid_stored_vector_style_using_defaults",
        );
      }
    }

    // Estimator failure must never block submission — best-effort, and never
    // logs the config itself (coords/canyon markers).
    let estimatedSeconds: number | null = null;
    try {
      estimatedSeconds = await estimateGeoPdfSeconds(config);
    } catch (err) {
      logger.warn({ err: safeErrorForLog(err) }, "geo_pdf_estimate_failed");
    }

    // Account-wide capacity before anything is persisted, so a refusal leaves
    // no queued row for the reaper to clean up.
    await assertGlobalCapacity("geoPdf");

    // Count + create in one transaction so concurrent submissions can't both
    // pass the per-user cap. The user-row lock closes the read-committed
    // double-read window the same way topo-exports does (ARCH-009).
    const job = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      // Monthly allowance, inside the same lock as the concurrency cap.
      await assertHasCredits(user, "geoPdf", estimatedSeconds, tx);
      const inFlight = await tx.geoPdfJob.count({
        where: { userId: user.id, status: { in: ["queued", "running"] } },
      });
      if (inFlight >= MAX_IN_FLIGHT_PER_USER) {
        throw new AppError(429, `Too many concurrent GeoPDF jobs (limit ${MAX_IN_FLIGHT_PER_USER})`);
      }
      return tx.geoPdfJob.create({
        data: {
          userId: user.id,
          config: config as object,
          vectorStyleSnapshot: vectorStyle as object,
          estimatedSeconds,
          status: "queued",
        },
      });
    });

    // launchFargateTask (Design L3) throws on placement failure (`failures[]`
    // populated / no task) as well as on SDK errors, so a launch problem can
    // never strand the job in `queued` (ARCH-002).
    if (ECS_SUBNETS.length) {
      try {
        const taskArn = await launchFargateTask({
          taskDefinition: ECS_GEO_PDF_TASK_DEF,
          containerName: "geo-pdf-worker",
          environment: [{ name: "GEO_PDF_JOB_ID", value: job.id }],
        });
        // Persist the ARN (Design L2) so the reaper can StopTask it.
        await prisma.geoPdfJob.update({
          where: { id: job.id },
          data: { ecsTaskArn: taskArn },
        });
      } catch (launchErr) {
        logger.error(
          { geoPdfJobId: job.id, reason: String(launchErr) },
          "geo_pdf_runtask_failed",
        );
        await prisma.geoPdfJob.update({
          where: { id: job.id },
          data: { status: "failed", errorMessage: "Failed to launch GeoPDF job." },
        });
        throw new AppError(500, "Failed to launch GeoPDF job");
      }
    }

    res.status(202).json(
      rowToView(
        {
          id: job.id,
          // The creator IS the owner on this path, so syncRole resolves to
          // "owner" — but it is passed rather than hardcoded so there is one
          // rule for the field, not one rule plus an exception.
          userId: user.id,
          status: "queued",
          config: job.config,
          estimatedSeconds: job.estimatedSeconds,
          resultBytes: null,
          errorMessage: null,
          createdAt: job.createdAt,
          completedAt: null,
        },
        null,
        user.id,
      ),
    );
  },
);

// GET /geo-pdf — list current user's recent GeoPDF jobs (most recent 50)
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    // Own jobs, plus jobs shared directly with me (read-only there).
    const where: Prisma.GeoPdfJobWhereInput = {
      OR: [
        { userId: user.id },
        { id: { in: await directlySharedIds(user.id, "geoPdfJob") } },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.geoPdfJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: GEO_PDF_LIST_CAP,
      }),
      prisma.geoPdfJob.count({ where }),
    ]);
    const views = await Promise.all(
      rows.map(async (r) =>
        rowToView(
          r,
          r.status === "completed"
            ? await presignResult(r.resultKey, geoPdfDownloadFilename(r.config, r.createdAt))
            : null,
          user.id,
        ),
      ),
    );
    // True total (pre-cap) so the client can flag a truncated view (UX-002).
    res.set("X-Total-Count", String(total));
    res.json({ jobs: views });
  },
);

// GET /geo-pdf/:id — single job status (used to re-presign expired URLs)
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const row = await prisma.geoPdfJob.findUnique({
      where: { id: getParam(req.params.id) },
    });
    if (!row) throw new AppError(404, "GeoPDF job not found");
    // Owner or share recipient; a stranger gets the same 404 a missing id gets.
    // The presigned download below rides this decision — a sharee may download,
    // which is the whole point of sharing a rendered PDF.
    requireShareAccess(await getJobRole(user.id, "geoPdfJob", row), "geoPdfJob");
    // Charged to the job's OWNER, not the caller: a sharee downloading a
    // rendered PDF spends the owner's allowance, because S3 attributes the
    // object to the owner. Gating on the caller instead would leave the
    // owner's allowance drainable by anyone they shared with.
    if (row.status === "completed") await assertHasEgressQuota(row.userId);
    const download =
      row.status === "completed"
        ? await presignResult(row.resultKey, geoPdfDownloadFilename(row.config, row.createdAt))
        : null;
    res.json(rowToView(row, download, user.id));
  },
);

// DELETE /geo-pdf/:id — clear a completed/failed job (cannot delete in-progress)
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const row = await prisma.geoPdfJob.findUnique({
      where: { id: getParam(req.params.id) },
    });
    if (!row) throw new AppError(404, "GeoPDF job not found");
    requireShareOwner(
      await getJobRole(user.id, "geoPdfJob", row),
      "geoPdfJob",
      "Only the owner can delete this GeoPDF",
    );
    if (row.status === "queued" || row.status === "running") {
      throw new AppError(409, "Cannot delete an in-progress GeoPDF job");
    }

    // Delete the S3 object and reclaim the storage quota in the same
    // transaction as the row delete so a completed job never orphans bytes.
    if (row.status === "completed" && row.resultKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: TOPO_BUCKET, Key: row.resultKey }));
    }
    await prisma.$transaction(async (tx) => {
      if (row.status === "completed" && row.resultBytes) {
        await tx.user.update({
          where: { id: user.id },
          data: { storageUsedBytes: { decrement: row.resultBytes } },
        });
      }
      // Share.entityId is polymorphic, so Postgres cannot cascade. No
      // tombstone: GeoPDF jobs are not delta-synced, so a recipient's next
      // GET /geo-pdf simply stops returning it.
      await deleteSharesFor(tx, "geoPdfJob", [row.id]);
      await tx.geoPdfJob.delete({ where: { id: row.id } });
    });
    res.status(204).send();
  },
);

export default router;
