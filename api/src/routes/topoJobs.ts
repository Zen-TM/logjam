import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { TOPO_LAYERS } from "../constants/topoLayers";
import type { TopoLayerName, TopoLayerFormat } from "../constants/topoLayers";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { RunTaskCommand } from "@aws-sdk/client-ecs";
import { s3, ecs } from "../services/awsClients";
import {
  parseZipCentralDirectory,
  classifyElvisEntries,
  ElvisZipError,
  validateTopoSettings,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { getParam } from "../lib/getParam";
import { assertCanSubmit, getWeeklyTileUsage } from "../lib/tileQuota";
import { assertHasStorageQuota, decrementStorageUsed } from "../lib/storageQuota";
import { deleteS3Prefix } from "../lib/s3Cleanup";

const router = Router();

const env = getEnv();
const TOPO_BUCKET = env.S3_BUCKET_TOPO ?? "";
const ECS_CLUSTER = env.ECS_CLUSTER;
const ECS_TASK_DEFINITION = env.ECS_TOPO_TASK_DEF;
const ECS_SUBNETS = env.ECS_SUBNETS_LIST;
const ECS_SECURITY_GROUPS = env.ECS_SECURITY_GROUPS_LIST;

async function getUser(cognitoSub: string) {
  const user = await prisma.user.findUnique({ where: { cognitoId: cognitoSub } });
  if (!user) throw new AppError(404, "User not found");
  return user;
}

// POST /topo-jobs — create job + return presigned S3 upload URL
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const { tileCount, jobName, settings } = req.body;

    await assertCanSubmit(user, tileCount);
    await assertHasStorageQuota(user.id);

    // Optional advanced render settings. Default preset is used when absent —
    // worker.py falls back to its built-in defaults if layerOptions is null.
    let layerOptions: object | undefined;
    if (settings !== undefined && settings !== null) {
      const validation = validateTopoSettings(settings);
      if (!validation.ok) {
        throw new AppError(400, `Invalid topo settings: ${validation.errors.join("; ")}`);
      }
      layerOptions = validation.value as object;
    }

    const estimatedSeconds = tileCount ? Math.round(tileCount * 8.5) * 60 : null;

    const job = await prisma.topoJob.create({
      data: {
        userId: user.id,
        status: "uploading",
        name: jobName ?? null,
        tileCount: tileCount ?? null,
        estimatedSeconds,
        layerOptions: layerOptions ?? undefined,
      },
    });

    const s3InputKey = `inputs/${job.id}/upload.zip`;
    await prisma.topoJob.update({
      where: { id: job.id },
      data: { s3InputKey },
    });

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: TOPO_BUCKET,
        Key: s3InputKey,
        ContentType: "application/zip",
      }),
      { expiresIn: 900 }, // 15 minutes
    );

    res.status(201).json({ jobId: job.id, uploadUrl });
  },
);

// POST /topo-jobs/:id/start — submit to queue after client uploads ZIP
router.post(
  "/:id/start",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const jobId = getParam(req.params.id);

    const job = await prisma.topoJob.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError(404, "Job not found");
    if (job.userId !== user.id) throw new AppError(403, "Access denied");
    if (job.status !== "uploading") throw new AppError(400, "Job is not awaiting upload");

    // Verify the S3 object was actually uploaded
    let objectSize: number;
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: TOPO_BUCKET, Key: job.s3InputKey! }),
      );
      objectSize = head.ContentLength ?? 0;
    } catch {
      throw new AppError(400, "ZIP file has not been uploaded yet");
    }

    // Re-validate ZIP central directory from S3 (range-GET last 64 KB).
    // Catches bypassed clients or corrupted uploads before paying ECS spin-up cost.
    // 64 KB fits ~900 central-directory entries — sufficient for all realistic ELVIS zips.
    const tailLen = Math.min(65536, objectSize);
    const rangeStart = objectSize - tailLen;
    const tail = await s3.send(
      new GetObjectCommand({
        Bucket: TOPO_BUCKET,
        Key: job.s3InputKey!,
        Range: `bytes=${rangeStart}-${objectSize - 1}`,
      }),
    );
    const tailBytes = await tail.Body!.transformToByteArray();
    let verifiedTileCount: number | null = null;
    try {
      const entries = parseZipCentralDirectory(
        new Uint8Array(tailBytes),
        objectSize,
      );
      const zipStats = classifyElvisEntries(entries);
      verifiedTileCount = zipStats.tileCount || null;
    } catch (e) {
      if (e instanceof ElvisZipError) {
        throw new AppError(400, e.message);
      }
      throw e;
    }

    // Authoritative quota check against server-counted tiles from the actual ZIP.
    // The job is still "uploading" so it won't appear in the weekly aggregate.
    await assertCanSubmit(user, verifiedTileCount);
    await assertHasStorageQuota(user.id);

    await prisma.topoJob.update({
      where: { id: jobId },
      data: {
        status: "pending",
        ...(verifiedTileCount !== null
          ? {
              tileCount: verifiedTileCount,
              estimatedSeconds: Math.round(verifiedTileCount * 8.5) * 60,
            }
          : {}),
      },
    });

    // ECS RunTask owns lifecycle; status column owns retry semantics.
    if (ECS_SUBNETS.length) {
      try {
        await ecs.send(new RunTaskCommand({
          cluster: ECS_CLUSTER,
          taskDefinition: ECS_TASK_DEFINITION,
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
              name: "topo-worker",
              environment: [{ name: "JOB_ID", value: jobId }],
            }],
          },
        }));
      } catch {
        await prisma.topoJob.update({
          where: { id: jobId },
          data: { status: "failed", errorMessage: "Failed to launch processing task." },
        });
        throw new AppError(500, "Failed to launch topo job");
      }
    }

    res.json({ jobId, status: "pending" });
  },
);

// GET /topo-jobs — list authenticated user's jobs
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const jobs = await prisma.topoJob.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        name: true,
        footprint: true,
        tileCount: true,
        estimatedSeconds: true,
        layerOptions: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(jobs);
  },
);

// GET /topo-jobs/completed-overlays — bulk overlay PMTiles URLs for the
// authenticated user's completed jobs. Replaces the old /topo-layers route.
// Returns one entry per completed job, each with presigned PMTiles URLs for
// every layer in TOPO_LAYERS that the job produced. Composite is excluded
// (MBTiles-only). URLs expire in 24h; response includes `expiresAt` so the
// client can pre-refetch before tiles start returning 403.
router.get(
  "/completed-overlays",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const jobs = await prisma.topoJob.findMany({
      where: { userId: user.id, status: "complete" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        footprint: true,
        createdAt: true,
        s3OutputKeys: true,
      },
    });

    const layerMetaByName = new Map<TopoLayerName, { format: TopoLayerFormat }>(
      TOPO_LAYERS.map((l) => [l.name, { format: l.format }]),
    );

    const presignTtlSeconds = 86400;
    const expiresAt = new Date(Date.now() + presignTtlSeconds * 1000).toISOString();

    const jobsResult = await Promise.all(
      jobs.map(async (j) => {
        const outputs =
          (j.s3OutputKeys as
            | { name: string; mbtilesKey: string; pmtilesKey: string | null }[]
            | null) ?? [];
        const layers = await Promise.all(
          outputs
            .filter((o): o is typeof o & { pmtilesKey: string } =>
              Boolean(o.pmtilesKey) && layerMetaByName.has(o.name as TopoLayerName),
            )
            .map(async (o) => {
              const meta = layerMetaByName.get(o.name as TopoLayerName)!;
              const pmtilesUrl = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: TOPO_BUCKET, Key: o.pmtilesKey }),
                { expiresIn: presignTtlSeconds },
              );
              return {
                name: o.name as TopoLayerName,
                format: meta.format,
                pmtilesUrl,
              };
            }),
        );
        return {
          jobId: j.id,
          name: j.name,
          createdAt: j.createdAt,
          footprint: j.footprint,
          layers,
        };
      }),
    );

    res.json({ jobs: jobsResult, expiresAt });
  },
);

// GET /topo-jobs/:id — get single job (for status polling)
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const job = await prisma.topoJob.findUnique({ where: { id: getParam(req.params.id) } });
    if (!job) throw new AppError(404, "Job not found");
    if (job.userId !== user.id) throw new AppError(403, "Access denied");
    res.json(job);
  },
);

// GET /topo-jobs/:id/download-urls — presigned GET URLs for all outputs
router.get(
  "/:id/download-urls",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const job = await prisma.topoJob.findUnique({ where: { id: getParam(req.params.id) } });
    if (!job) throw new AppError(404, "Job not found");
    if (job.userId !== user.id) throw new AppError(403, "Access denied");
    if (job.status !== "complete") throw new AppError(400, "Job is not complete");

    const outputs = job.s3OutputKeys as { name: string; mbtilesKey: string; pmtilesKey: string }[] | null;
    if (!outputs?.length) throw new AppError(500, "No output keys recorded");

    const signed = await Promise.all(
      outputs.map(async (o) => ({
        name: o.name,
        mbtilesUrl: await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: TOPO_BUCKET, Key: o.mbtilesKey }),
          { expiresIn: 86400 }, // 24 hours
        ),
        pmtilesUrl: o.pmtilesKey
          ? await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: TOPO_BUCKET, Key: o.pmtilesKey }),
              { expiresIn: 86400 },
            )
          : null,
      })),
    );

    res.json(signed);
  },
);

// DELETE /topo-jobs/:id — delete job and all S3 objects
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const jobId = getParam(req.params.id);
    const job = await prisma.topoJob.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError(404, "Job not found");
    if (job.userId !== user.id) throw new AppError(403, "Access denied");

    await prisma.topoJob.delete({ where: { id: jobId } });

    await Promise.all(
      [`inputs/${jobId}/`, `outputs/${jobId}/`, `jobs/${jobId}/`].map((prefix) =>
        deleteS3Prefix(TOPO_BUCKET, prefix),
      ),
    );
    await decrementStorageUsed(job.userId, job.outputBytes ?? 0n);

    res.status(204).send();
  },
);

export default router;
