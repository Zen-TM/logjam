import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { S3Client, HeadObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";

const router = Router();

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-southeast-2" });
const sqs = new SQSClient({ region: process.env.AWS_REGION ?? "ap-southeast-2" });
const ecs = new ECSClient({ region: process.env.AWS_REGION ?? "ap-southeast-2" });

const TOPO_BUCKET = process.env.S3_BUCKET_TOPO!;
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL!;
const ECS_CLUSTER = process.env.ECS_CLUSTER ?? "logjam-cluster";
const ECS_TASK_DEFINITION = process.env.ECS_TOPO_TASK_DEF ?? "logjam-topo-worker";
const ECS_SUBNETS = (process.env.ECS_SUBNETS ?? "").split(",").filter(Boolean);
const ECS_SECURITY_GROUPS = (process.env.ECS_SECURITY_GROUPS ?? "").split(",").filter(Boolean);

function getParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

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
    const { layerOptions, tileCount, jobName, filename } = req.body;

    if (!layerOptions?.length) {
      throw new AppError(400, "layerOptions is required");
    }

    const estimatedSeconds = tileCount ? Math.round(tileCount * 8.5) * 60 : null;

    const job = await prisma.topoJob.create({
      data: {
        userId: user.id,
        status: "uploading",
        name: jobName ?? null,
        tileCount: tileCount ?? null,
        estimatedSeconds,
        layerOptions,
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
    try {
      await s3.send(new HeadObjectCommand({ Bucket: TOPO_BUCKET, Key: job.s3InputKey! }));
    } catch {
      throw new AppError(400, "ZIP file has not been uploaded yet");
    }

    await prisma.topoJob.update({ where: { id: jobId }, data: { status: "pending" } });

    // Publish SQS message
    if (SQS_QUEUE_URL) {
      await sqs.send(new SendMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MessageBody: JSON.stringify({
          jobId,
          s3InputKey: job.s3InputKey,
          layerOptions: job.layerOptions,
        }),
      }));
    }

    // Trigger on-demand Fargate task if configured
    if (ECS_SUBNETS.length) {
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

    // List and delete all S3 objects for this job
    const prefixes = [`inputs/${jobId}/`, `outputs/${jobId}/`, `jobs/${jobId}/`];
    for (const prefix of prefixes) {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: TOPO_BUCKET, Prefix: prefix }));
      const keys = listed.Contents?.map((o) => ({ Key: o.Key! })) ?? [];
      if (keys.length) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: TOPO_BUCKET,
          Delete: { Objects: keys },
        }));
      }
    }

    await prisma.topoJob.delete({ where: { id: jobId } });
    res.status(204).send();
  },
);

export default router;
