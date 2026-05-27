// Stage 2 — on-demand export pipeline.
//
// Users submit POST /topo-exports with {sourceJobIds, layers, format,
// bundling}. The server snapshots the live vector style, persists a
// TopoExportJob row, and launches an ECS task that produces the requested
// artefact and emails the user when ready. The dialog polls
// GET /topo-exports for the recent-exports list and pre-signed download URLs.

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { RunTaskCommand } from "@aws-sdk/client-ecs";
import { s3, ecs } from "../services/awsClients";
import {
  EXPORT_FORMAT_RULES,
  validateExportRequest,
  VECTOR_STYLE_DEFAULTS,
  type ExportFormat,
  type ExportBundling,
  type TopoExportJobView,
  type TopoLayerKey,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { getParam } from "../lib/getParam";

const router = Router();

const env = getEnv();
const TOPO_BUCKET = env.S3_BUCKET_TOPO ?? "";
const ECS_CLUSTER = env.ECS_CLUSTER;
const ECS_EXPORT_TASK_DEF = env.ECS_TOPO_EXPORT_TASK_DEF;
const ECS_SUBNETS = env.ECS_SUBNETS_LIST;
const ECS_SECURITY_GROUPS = env.ECS_SECURITY_GROUPS_LIST;

// Cap to prevent users from flooding ECS with queued exports.
const MAX_QUEUED_PER_USER = 5;
const PRESIGN_TTL_SECONDS = 86400; // 24h

async function getUser(cognitoSub: string) {
  const user = await prisma.user.findUnique({ where: { cognitoId: cognitoSub } });
  if (!user) throw new AppError(404, "User not found");
  return user;
}

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

    const { sourceJobIds, layers, format, bundling } = req.body as {
      sourceJobIds?: unknown;
      layers?: unknown;
      format?: unknown;
      bundling?: unknown;
    };

    if (!Array.isArray(sourceJobIds) || sourceJobIds.length !== 1) {
      throw new AppError(400, "sourceJobIds must be a single-element array");
    }
    if (!Array.isArray(layers) || !layers.every((l) => typeof l === "string")) {
      throw new AppError(400, "layers must be an array of strings");
    }
    if (typeof format !== "string" || !(format in EXPORT_FORMAT_RULES)) {
      throw new AppError(400, "format must be one of " + Object.keys(EXPORT_FORMAT_RULES).join(","));
    }
    if (bundling !== "composite" && bundling !== "per-layer") {
      throw new AppError(400, "bundling must be 'composite' or 'per-layer'");
    }

    const v = validateExportRequest({
      format: format as ExportFormat,
      bundling,
      layers: layers as TopoLayerKey[],
    });
    if (!v.ok) throw new AppError(400, v.error);

    // Ownership check on every source job.
    const jobs = await prisma.topoJob.findMany({
      where: { id: { in: sourceJobIds as string[] }, userId: user.id },
    });
    if (jobs.length !== sourceJobIds.length) {
      throw new AppError(404, "One or more source jobs not found");
    }
    for (const j of jobs) {
      if (j.status !== "complete") {
        throw new AppError(400, `Job ${j.id} is not complete`);
      }
    }

    const queued = await prisma.topoExportJob.count({
      where: { userId: user.id, status: { in: ["queued", "running"] } },
    });
    if (queued >= MAX_QUEUED_PER_USER) {
      throw new AppError(429, `Too many concurrent exports (limit ${MAX_QUEUED_PER_USER})`);
    }

    const vectorStyleSnapshot = (user.vectorStyle as object | null) ?? VECTOR_STYLE_DEFAULTS;

    const exportJob = await prisma.topoExportJob.create({
      data: {
        userId: user.id,
        sourceJobIds: sourceJobIds as string[],
        layers: layers as string[],
        format,
        bundling,
        vectorStyleSnapshot,
        status: "queued",
      },
    });

    if (ECS_SUBNETS.length) {
      try {
        await ecs.send(new RunTaskCommand({
          cluster: ECS_CLUSTER,
          taskDefinition: ECS_EXPORT_TASK_DEF,
          launchType: "FARGATE",
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: ECS_SUBNETS,
              securityGroups: ECS_SECURITY_GROUPS,
              assignPublicIp: "ENABLED",
            },
          },
          overrides: {
            containerOverrides: [{
              name: "topo-export-worker",
              environment: [{ name: "EXPORT_JOB_ID", value: exportJob.id }],
            }],
          },
        }));
      } catch {
        await prisma.topoExportJob.update({
          where: { id: exportJob.id },
          data: { status: "failed", errorMessage: "Failed to launch export task." },
        });
        throw new AppError(500, "Failed to launch export job");
      }
    }

    res.status(201).json({ id: exportJob.id });
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
    // No best-effort S3 delete here yet — the export bucket has an
    // independent lifecycle policy that ages exports out automatically.
    await prisma.topoExportJob.delete({ where: { id: row.id } });
    res.status(204).send();
  },
);

export default router;
