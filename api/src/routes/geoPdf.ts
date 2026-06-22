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
import { logger } from "../lib/logger";
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
import { launchFargateTask } from "../lib/ecsRunTask";
import { assertHasStorageQuota } from "../lib/storageQuota";
import { resolveUser as getUser } from "../lib/resolveUser";

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

async function presignResult(resultKey: string | null): Promise<{ url: string; expiresAt: string } | null> {
  if (!resultKey) return null;
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: TOPO_BUCKET, Key: resultKey }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
  const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString();
  return { url, expiresAt };
}

function rowToView(
  row: {
    id: string;
    status: string;
    resultBytes: bigint | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
  },
  download: { url: string; expiresAt: string } | null,
): GeoPdfJobView {
  return {
    id: row.id,
    status: row.status as GeoPdfJobStatus,
    resultBytes: row.resultBytes !== null ? Number(row.resultBytes) : null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
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

    // Count + create in one transaction so concurrent submissions can't both
    // pass the per-user cap. The user-row lock closes the read-committed
    // double-read window the same way topo-exports does (ARCH-009).
    const job = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
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
          status: "queued",
          resultBytes: null,
          errorMessage: null,
          createdAt: job.createdAt,
          completedAt: null,
        },
        null,
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
    const rows = await prisma.geoPdfJob.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const views = await Promise.all(
      rows.map(async (r) => rowToView(r, r.status === "completed" ? await presignResult(r.resultKey) : null)),
    );
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
    if (row.userId !== user.id) throw new AppError(404, "GeoPDF job not found");
    const download = row.status === "completed" ? await presignResult(row.resultKey) : null;
    res.json(rowToView(row, download));
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
    if (row.userId !== user.id) throw new AppError(404, "GeoPDF job not found");
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
      await tx.geoPdfJob.delete({ where: { id: row.id } });
    });
    res.status(204).send();
  },
);

export default router;
