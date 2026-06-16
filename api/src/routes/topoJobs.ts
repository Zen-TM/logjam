import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { StopTaskCommand } from "@aws-sdk/client-ecs";
import { TOPO_LAYERS } from "../constants/topoLayers";
import type { TopoLayerName, TopoLayerFormat } from "../constants/topoLayers";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, ecs } from "../services/awsClients";
import {
  parseZipCentralDirectory,
  classifyElvisEntries,
  ElvisZipError,
  validateRasterTemplateSettings,
  validateAutoExportSettings,
  VECTOR_STYLE_DEFAULTS,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { getParam } from "../lib/getParam";
import { launchFargateTask } from "../lib/ecsRunTask";
import { assertCanSubmit } from "../lib/tileQuota";
import { assertHasStorageQuota, decrementStorageUsed } from "../lib/storageQuota";
import { deleteS3Prefix } from "../lib/s3Cleanup";
import { resolveUser as getUser } from "../lib/resolveUser";

const router = Router();

const env = getEnv();
const TOPO_BUCKET = env.S3_BUCKET_TOPO ?? "";

// Input-ZIP size caps (zip-bomb / disk-DoS guard for the Fargate worker).
// A legitimate ELVIS export is bounded by the weekly tile quota (default 100
// tiles, ~17 MB compressed LAZ + ~5 MB DEM each). These caps sit well above
// any realistic export while rejecting pathological archives before the worker
// is launched. The uncompressed cap is the real bomb guard; the compressed cap
// bounds wasted S3 transfer/storage.
const MAX_INPUT_ZIP_COMPRESSED_BYTES = 25 * 1024 * 1024 * 1024; // 25 GB
const MAX_INPUT_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB
const ECS_TASK_DEFINITION = env.ECS_TOPO_TASK_DEF;
// Empty subnet list = local dev without LocalStack ECS: skip the launch and
// leave the job pending for manual worker runs.
const ECS_SUBNETS = env.ECS_SUBNETS_LIST;

// POST /topo-jobs — create job + return presigned S3 upload URL
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const { tileCount, jobName, settings, autoExport } = req.body;

    await assertCanSubmit(user, tileCount);
    await assertHasStorageQuota(user.id);

    // Optional raster template settings. Worker falls back to its built-in
    // defaults if layerOptions is null.
    let layerOptions: object | undefined;
    if (settings !== undefined && settings !== null) {
      const validation = validateRasterTemplateSettings(settings);
      if (!validation.ok) {
        throw new AppError(400, `Invalid topo settings: ${validation.errors.join("; ")}`);
      }
      layerOptions = validation.value as object;
    }

    // Optional auto-export config. Persisted so the reaper can queue a
    // TopoExportJob once this job completes. Validated to the same legality
    // rules as a manual export so a bad config can't strand the auto-export.
    let autoExportConfig: object | undefined;
    if (autoExport !== undefined && autoExport !== null) {
      const validation = validateAutoExportSettings(autoExport);
      if (!validation.ok) {
        throw new AppError(400, `Invalid auto-export settings: ${validation.errors.join("; ")}`);
      }
      autoExportConfig = validation.value as object;
    }

    // Snapshot the user's live vector style at submission time. The composite
    // raster bake uses this snapshot; in-app display reads the live value
    // independently. Falls back to defaults if the column is null.
    const vectorStyleSnapshot = (user.vectorStyle as object | null) ?? VECTOR_STYLE_DEFAULTS;

    const estimatedSeconds = tileCount ? Math.round(tileCount * 8.5) * 60 : null;

    const job = await prisma.topoJob.create({
      data: {
        userId: user.id,
        status: "uploading",
        name: jobName ?? null,
        tileCount: tileCount ?? null,
        estimatedSeconds,
        layerOptions: layerOptions ?? undefined,
        autoExport: autoExportConfig ?? undefined,
        vectorStyleSnapshot,
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

    // Reject an oversized upload before reading/extracting it (compressed cap).
    if (objectSize > MAX_INPUT_ZIP_COMPRESSED_BYTES) {
      throw new AppError(413, "Uploaded ZIP exceeds the maximum allowed size.");
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
      // Zip-bomb guard: reject if the declared uncompressed payload would
      // exhaust the worker's disk before the worker is ever launched.
      if (zipStats.uncompressedBytes > MAX_INPUT_ZIP_UNCOMPRESSED_BYTES) {
        throw new AppError(
          413,
          "ZIP uncompressed size exceeds the maximum allowed for processing.",
        );
      }
      verifiedTileCount = zipStats.tileCount || null;
    } catch (e) {
      if (e instanceof ElvisZipError) {
        throw new AppError(400, e.message);
      }
      throw e;
    }

    // Authoritative quota check against server-counted tiles from the actual
    // ZIP, serialised per user (ARCH-009): the user-row lock prevents two
    // concurrent /start calls from both reading the same weekly aggregate and
    // both passing. The job is still "uploading" so it won't appear in the
    // aggregate. RunTask stays outside the transaction (no AWS calls inside
    // DB transactions); the earlier checks above remain advisory pre-checks.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      await assertCanSubmit(user, verifiedTileCount, tx);
      await assertHasStorageQuota(user.id, 0n, tx);
      const flipped = await tx.topoJob.updateMany({
        // Status guard doubles as a double-/start race close: a concurrent
        // second /start finds 0 rows and 400s instead of double-launching.
        where: { id: jobId, status: "uploading" },
        data: {
          status: "pending",
          attemptCount: { increment: 1 },
          ...(verifiedTileCount !== null
            ? {
                tileCount: verifiedTileCount,
                estimatedSeconds: Math.round(verifiedTileCount * 8.5) * 60,
              }
            : {}),
        },
      });
      if (flipped.count === 0) {
        throw new AppError(400, "Job is not awaiting upload");
      }
    });

    // ECS RunTask owns lifecycle; status column owns retry semantics.
    // launchFargateTask (Design L3) throws on placement failure (`failures[]`
    // populated / no task) as well as on SDK errors, so a launch problem can
    // never strand the job in `pending` (ARCH-002a).
    if (ECS_SUBNETS.length) {
      try {
        const taskArn = await launchFargateTask({
          taskDefinition: ECS_TASK_DEFINITION,
          containerName: "topo-worker",
          environment: [{ name: "JOB_ID", value: jobId }],
        });
        // Persist the ARN (Design L2) so the reaper / DELETE can StopTask it.
        await prisma.topoJob.update({
          where: { id: jobId },
          data: { ecsTaskArn: taskArn },
        });
      } catch (launchErr) {
        // Do not leak the raw AWS error to the client or the job row; log the
        // reason server-side (no canyon coords/names involved here).
        console.error(
          JSON.stringify({ event: "topo_runtask_failed", jobId, reason: String(launchErr) }),
        );
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
// authenticated user's completed jobs. Returns one entry per completed job,
// each with presigned PMTiles URLs for every layer the job produced.
// URLs expire in 24h; response includes `expiresAt` so the client can
// pre-refetch before tiles start returning 403.
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
            | { name: string; cogKey: string | null; pmtilesKey: string | null }[]
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
    const job = await prisma.topoJob.findUnique({
      where: { id: getParam(req.params.id) },
      select: {
        id: true,
        userId: true, // needed for ownership check below
        status: true,
        name: true,
        footprint: true,
        tileCount: true,
        estimatedSeconds: true,
        layerOptions: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        s3OutputKeys: true,
      },
    });
    if (!job) throw new AppError(404, "Job not found");
    if (job.userId !== user.id) throw new AppError(403, "Access denied");
    res.json(job);
  },
);

// (Stage 2) Per-job download URLs are gone. All downloads now go through
// POST /topo-exports → the export worker. See routes/topoExports.ts.

// DELETE /topo-jobs/:id — delete job and all S3 objects. In-flight jobs are
// cancel-then-purged (Design L5): the row is force-failed (status-guarded)
// so the worker can't complete it mid-delete, the Fargate task is stopped
// best-effort, and only then are the prefixes purged and the row removed.
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const jobId = getParam(req.params.id);
    const job = await prisma.topoJob.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError(404, "Job not found");
    if (job.userId !== user.id) throw new AppError(403, "Access denied");

    // A running export is actively reading this job's COGs from
    // outputs/{jobId}/ — refuse until it finishes (no FK on sourceJobIds, so
    // this is the only referential guard).
    const runningExports = await prisma.topoExportJob.count({
      where: { status: "running", sourceJobIds: { has: jobId } },
    });
    if (runningExports > 0) {
      throw new AppError(
        409,
        "An export of this job is currently running. Try again when it finishes.",
      );
    }

    if (job.status === "pending" || job.status === "processing") {
      // Cancel: status-guarded flip so a worker that completes between the
      // ownership read and this write wins (its storage charge then matches
      // the fresh outputBytes re-read below). After the flip, the worker's
      // guarded terminal write (Design L1) matches 0 rows and self-cleans, so
      // a missed StopTask only costs Fargate time.
      await prisma.topoJob.updateMany({
        where: { id: jobId, status: { in: ["pending", "processing"] } },
        data: { status: "failed", errorMessage: "Canceled by user." },
      });
      if (job.ecsTaskArn) {
        try {
          await ecs.send(
            new StopTaskCommand({
              cluster: env.ECS_CLUSTER,
              task: job.ecsTaskArn,
              reason: "Job deleted by user",
            }),
          );
        } catch (stopErr) {
          console.error(
            JSON.stringify({
              event: "topo_job_delete_stop_task_failed",
              jobId,
              reason: String(stopErr),
            }),
          );
        }
      }
    }

    // Re-read outputBytes: the worker may have completed between the
    // ownership read and the cancel flip — the decrement must match what was
    // actually charged.
    const fresh = await prisma.topoJob.findUnique({
      where: { id: jobId },
      select: { outputBytes: true },
    });
    if (!fresh) throw new AppError(404, "Job not found");

    // S3-first (ARCH-004): delete the objects before the DB row and the quota
    // decrement. deleteS3Prefix throws on failure, so if any prefix fails the
    // row survives and a retried DELETE re-derives the same jobId-keyed prefixes
    // — no orphaned objects, and the quota is only decremented once the bytes
    // are confirmed gone. (decrementStorageUsed clamps at 0 — keep it for that.)
    await Promise.all(
      [`inputs/${jobId}/`, `outputs/${jobId}/`, `jobs/${jobId}/`].map((prefix) =>
        deleteS3Prefix(TOPO_BUCKET, prefix),
      ),
    );

    // One transaction (Design Q): queued exports referencing this job are
    // force-failed with a clear message (their COG source is about to
    // disappear), and the row delete commits with the quota decrement.
    await prisma.$transaction(async (tx) => {
      await tx.topoExportJob.updateMany({
        where: { status: "queued", sourceJobIds: { has: jobId } },
        data: {
          status: "failed",
          errorMessage: "A source topo job was deleted before the export started.",
        },
      });
      await tx.topoJob.delete({ where: { id: jobId } });
      await decrementStorageUsed(job.userId, fresh.outputBytes ?? 0n, tx);
    });

    res.status(204).send();
  },
);

export default router;
