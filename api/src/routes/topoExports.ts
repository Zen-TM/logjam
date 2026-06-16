// Stage 2 — on-demand export pipeline.
//
// Users submit POST /topo-exports with {sourceJobIds, layers, format,
// bundling}. The server snapshots the live vector style, persists a
// TopoExportJob row, and launches an ECS task that produces the requested
// artefact and emails the user when ready. The dialog polls
// GET /topo-exports for the recent-exports list and pre-signed download URLs.

import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../services/awsClients";
import {
  EXPORT_FORMAT_RULES,
  RASTER_LAYERS,
  validateExportRequest,
  VECTOR_STYLE_DEFAULTS,
  type ExportFormat,
  type ExportBundling,
  type TopoExportJobView,
  type TopoLayerKey,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { getParam } from "../lib/getParam";
import { createAndLaunchTopoExport } from "../lib/topoExportLauncher";
import { assertHasStorageQuota } from "../lib/storageQuota";
import { resolveUser as getUser } from "../lib/resolveUser";

const exportRequestSchema = z.object({
  sourceJobIds: z.array(z.string()).length(1),
  layers: z.array(z.string()).min(1),
  format: z.enum(Object.keys(EXPORT_FORMAT_RULES) as [string, ...string[]]),
  bundling: z.enum(["composite", "per-layer"]),
});

type S3OutputKey = { name: string; cogKey: string | null; pmtilesKey: string | null };

const router = Router();

const env = getEnv();
const TOPO_BUCKET = env.S3_BUCKET_TOPO ?? "";
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
    sourceJobIds: string[];
    layers: string[];
    format: string;
    bundling: string;
    status: string;
    resultBytes: bigint | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
  },
  download: { url: string; expiresAt: string } | null,
): TopoExportJobView {
  return {
    id: row.id,
    sourceJobIds: row.sourceJobIds,
    layers: row.layers as TopoLayerKey[],
    format: row.format as ExportFormat,
    bundling: row.bundling as ExportBundling,
    status: row.status as TopoExportJobView["status"],
    resultBytes: row.resultBytes !== null ? Number(row.resultBytes) : null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    downloadUrl: download?.url ?? null,
    downloadExpiresAt: download?.expiresAt ?? null,
  };
}

// POST /topo-exports — submit a new export job
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);

    // Entry gate (ARCH-012): every byte-producing flow checks storage quota at
    // submission. The worker charges result_bytes unconditionally on
    // completion, so without this an over-quota user could keep accruing.
    // No pre-render size estimate exists, so this is the same soft gate the
    // other flows use (in-flight work may still finish past quota, bounded by
    // the per-user concurrency cap).
    await assertHasStorageQuota(user.id);

    const parsed = exportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues[0]?.message ?? "Invalid export request");
    }
    const { sourceJobIds, bundling } = parsed.data;
    const format = parsed.data.format as ExportFormat;
    const layers = parsed.data.layers as TopoLayerKey[];

    const v = validateExportRequest({ format, bundling, layers });
    if (!v.ok) throw new AppError(400, v.error);

    // Ownership check on every source job.
    const jobs = await prisma.topoJob.findMany({
      where: { id: { in: sourceJobIds }, userId: user.id },
    });
    if (jobs.length !== sourceJobIds.length) {
      throw new AppError(404, "One or more source jobs not found");
    }
    for (const j of jobs) {
      if (j.status !== "complete") {
        throw new AppError(400, `Job ${j.id} is not complete`);
      }
    }

    // Reject pre-Stage-2 jobs whose outputs predate the COG export source:
    // they would otherwise fail deep inside the export worker. Only raster
    // layers need a COG; vector layers export from raw GeoJSON.
    const requestedRasterLayers = layers.filter((l) => RASTER_LAYERS.includes(l));
    for (const j of jobs) {
      const outputs = (j.s3OutputKeys as S3OutputKey[] | null) ?? [];
      for (const layer of requestedRasterLayers) {
        const match = outputs.find((o) => o.name === layer);
        if (!match?.cogKey) {
          throw new AppError(400, "Re-run this job to enable exports");
        }
      }
    }

    const vectorStyleSnapshot = (user.vectorStyle as object | null) ?? VECTOR_STYLE_DEFAULTS;

    // Cap-checked create + ECS launch — shared with the reaper's auto-export
    // pass so both enforce the same per-user concurrency limit (ARCH-009) and
    // fail-on-launch semantics (ARCH-002).
    const exportJobId = await createAndLaunchTopoExport({
      userId: user.id,
      sourceJobIds,
      layers,
      format,
      bundling,
      vectorStyleSnapshot,
    });

    res.status(201).json({ id: exportJobId });
  },
);

// GET /topo-exports — list current user's recent exports (most recent 50)
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const rows = await prisma.topoExportJob.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const views = await Promise.all(
      rows.map(async (r) => rowToView(r, r.status === "completed" ? await presignResult(r.resultKey) : null)),
    );
    res.json({ exports: views });
  },
);

// GET /topo-exports/:id — single export status (used to re-presign expired URLs)
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const row = await prisma.topoExportJob.findUnique({
      where: { id: getParam(req.params.id) },
    });
    if (!row) throw new AppError(404, "Export not found");
    if (row.userId !== user.id) throw new AppError(403, "Access denied");
    const download = row.status === "completed" ? await presignResult(row.resultKey) : null;
    res.json(rowToView(row, download));
  },
);

// DELETE /topo-exports/:id — cancel a queued export or clear a completed one
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const row = await prisma.topoExportJob.findUnique({
      where: { id: getParam(req.params.id) },
    });
    if (!row) throw new AppError(404, "Export not found");
    if (row.userId !== user.id) throw new AppError(403, "Access denied");
    if (row.status === "queued" || row.status === "running") {
      throw new AppError(409, "Cannot delete an in-progress export");
    }

    // Delete the S3 object and reclaim the storage quota in the same
    // transaction as the row delete so a completed export never orphans bytes.
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
      await tx.topoExportJob.delete({ where: { id: row.id } });
    });
    res.status(204).send();
  },
);

export default router;
