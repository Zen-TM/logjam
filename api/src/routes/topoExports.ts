// On-demand export pipeline.
//
// Users submit POST /topo-exports with {bbox, layers, format}: an export of an
// area. The server persists a TopoExportJob row and launches an ECS task that
// produces the file and emails the user when ready. Logjam Web polls
// GET /topo-exports for the recent-exports list and pre-signed download URLs;
// older exports of a LiDAR topo are listed there until they expire.

import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError, malformed } from "../middleware/errorHandler";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../services/awsClients";
import {
  say,
  AREA_EXPORT_FORMATS,
  AREA_EXPORT_LAYERS,
  AREA_EXPORT_OUTSIDE_NSW,
  AREA_EXPORT_TOO_LARGE,
  areaExportRequestError,
  areaExportStyleSnapshot,
  areaExportTooLarge,
  areaInNsw,
  type AreaBbox,
  type ExportFormat,
  type ExportBundling,
  type TopoExportJobView,
  type TopoLayerKey,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { getParam } from "../lib/getParam";
import { createAndLaunchTopoExport } from "../lib/topoExportLauncher";
import {
  assertHasStorageQuota,
  decrementStorageUsed,
} from "../lib/storageQuota";
import { assertHasEgressQuota } from "../lib/egressQuota";
import { resolveUser as getUser } from "../lib/resolveUser";

// An export of an area: the statewide terrain over a box (topo/area_export.py).
const areaRequestSchema = z.object({
  bbox: z.object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  }),
  layers: z
    .array(z.enum(AREA_EXPORT_LAYERS))
    .min(1)
    .max(AREA_EXPORT_LAYERS.length),
  format: z.enum(AREA_EXPORT_FORMATS),
});

const router = Router();

const env = getEnv();
const TOPO_BUCKET = env.S3_BUCKET_TOPO ?? "";
const PRESIGN_TTL_SECONDS = 86400; // 24h

// Server-side cap on the exports list. X-Total-Count carries the true total so
// the client can show a truncation caption when this cap bites.
const EXPORT_LIST_CAP = 50;

async function presignResult(
  resultKey: string | null,
): Promise<{ url: string; expiresAt: string } | null> {
  if (!resultKey) return null;
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: TOPO_BUCKET, Key: resultKey }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
  const expiresAt = new Date(
    Date.now() + PRESIGN_TTL_SECONDS * 1000,
  ).toISOString();
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
    estimatedSeconds: number | null;
    resultBytes: bigint | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
    bbox: unknown;
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
    estimatedSeconds: row.estimatedSeconds,
    resultBytes: row.resultBytes !== null ? Number(row.resultBytes) : null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    bbox: (row.bbox as AreaBbox | null) ?? null,
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

    // Entry gate: every byte-producing flow checks storage quota at
    // submission. The worker charges result_bytes unconditionally on
    // completion, so without this an over-quota user could keep accruing.
    // No pre-render size estimate exists, so this is the same soft gate the
    // other flows use (in-flight work may still finish past quota, bounded by
    // the per-user concurrency cap).
    await assertHasStorageQuota(user.id);

    const area = areaRequestSchema.safeParse(req.body);
    if (!area.success) {
      throw malformed(area.error.issues[0]?.message ?? "Invalid area export");
    }
    const detail = areaExportRequestError(area.data);
    if (detail) throw malformed(detail);
    if (areaExportTooLarge(area.data.bbox)) {
      throw new AppError(400, AREA_EXPORT_TOO_LARGE);
    }
    if (!areaInNsw(area.data.bbox)) {
      throw new AppError(400, AREA_EXPORT_OUTSIDE_NSW);
    }
    const exportJobId = await createAndLaunchTopoExport({
      userId: user.id,
      sourceJobIds: [],
      layers: area.data.layers,
      format: area.data.format,
      // A GeoTIFF is a file per layer; a GeoPackage or MBTiles holds them all.
      bundling: area.data.format === "geotiff" ? "per-layer" : "composite",
      vectorStyleSnapshot: areaExportStyleSnapshot(
        area.data.format,
        user.uiPreferences,
      ),
      // No size signal the estimator knows yet, so no estimate.
      sourceTileCount: null,
      monthlyComputeCredits: user.monthlyComputeCredits,
      bbox: area.data.bbox,
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
    const where = { userId: user.id };
    const [rows, total] = await Promise.all([
      prisma.topoExportJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: EXPORT_LIST_CAP,
      }),
      prisma.topoExportJob.count({ where }),
    ]);
    const views = await Promise.all(
      rows.map(async (r) =>
        rowToView(
          r,
          r.status === "completed" ? await presignResult(r.resultKey) : null,
        ),
      ),
    );
    // True total (pre-cap) so the client can flag a truncated view.
    res.set("X-Total-Count", String(total));
    res.json({ exports: views });
  },
);

// GET /topo-exports/:id — single export status (used to re-presign expired URLs)
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    // Owner-scoped lookup: a foreign export id gets the SAME 404 a
    // non-existent one gets, so the status is no existence oracle for export
    // ids the caller may not see (matching topoJobs.ts).
    const row = await prisma.topoExportJob.findFirst({
      where: { id: getParam(req.params.id), userId: user.id },
    });
    if (!row) throw new AppError(404, say`Couldn't find that export.`);
    // An export artefact is one of the largest single objects the app serves,
    // and this endpoint exists to re-mint an expired URL — i.e. it is the
    // deliberate "download it again" action. Owner-scoped above, so the caller
    // is the owner whose allowance pays for it.
    if (row.status === "completed") await assertHasEgressQuota(user.id);
    const download =
      row.status === "completed" ? await presignResult(row.resultKey) : null;
    res.json(rowToView(row, download));
  },
);

// DELETE /topo-exports/:id — cancel a queued export or clear a completed one
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    // Owner-scoped lookup: a foreign export id gets the SAME 404 a
    // non-existent one gets, so the status is no existence oracle for export
    // ids the caller may not see (matching topoJobs.ts).
    const row = await prisma.topoExportJob.findFirst({
      where: { id: getParam(req.params.id), userId: user.id },
    });
    if (!row) throw new AppError(404, say`Couldn't find that export.`);
    if (row.status === "queued" || row.status === "running") {
      throw new AppError(
        409,
        say`An export that is still running can't be deleted.`,
      );
    }

    // Delete the S3 object and reclaim the storage quota in the same
    // transaction as the row delete so a completed export never orphans bytes.
    if (row.status === "completed" && row.resultKey) {
      await s3.send(
        new DeleteObjectCommand({ Bucket: TOPO_BUCKET, Key: row.resultKey }),
      );
    }
    await prisma.$transaction(async (tx) => {
      if (row.status === "completed" && row.resultBytes) {
        await decrementStorageUsed(user.id, row.resultBytes, tx);
      }
      await tx.topoExportJob.delete({ where: { id: row.id } });
    });
    res.status(204).send();
  },
);

export default router;
