import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError, malformed } from "../middleware/errorHandler";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { StopTaskCommand } from "@aws-sdk/client-ecs";
import { TOPO_LAYERS } from "../constants/topoLayers";
import type { TopoLayerName, TopoLayerFormat } from "../constants/topoLayers";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PutObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { s3, ecs } from "../services/awsClients";
import {
  say,
  parseZipCentralDirectory,
  classifyElvisEntries,
  ElvisZipError,
  validateRasterTemplateSettings,
  validateAutoExportSettings,
  VECTOR_STYLE_DEFAULTS,
  RASTER_TEMPLATE_DEFAULTS,
  SHARPEN_NEW_JOBS,
  TOPO_UPLOAD_SIGN_MAX,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { getParam } from "../lib/getParam";
import { launchFargateTask } from "../lib/ecsRunTask";
import { assertHasCredits } from "../lib/computeCredits";
import { estimateTopoSeconds } from "../lib/runtimeEstimates";
import { assertGlobalCapacity } from "../lib/fargateCapacity";
import {
  assertHasStorageQuota,
  decrementStorageUsed,
} from "../lib/storageQuota";
import {
  MAX_INPUT_ZIP_COMPRESSED_BYTES,
  TOPO_UPLOAD_MAX_PARTS,
  TOPO_UPLOAD_PART_BYTES,
  deleteTopoJobObjects,
  joinTopoUpload,
  signTopoParts,
} from "../lib/topoUpload";
import { logger } from "../lib/logger";
import { resolveUser as getUser } from "../lib/resolveUser";
import {
  deleteSharesFor,
  directlySharedIds,
  getJobRole,
  requireShareAccess,
  requireShareOwner,
} from "../lib/shareAccess";

const router = Router();

const env = getEnv();
const TOPO_BUCKET = env.S3_BUCKET_TOPO ?? "";
/** A job's user-facing label. Same ceiling place names use. */
export const TOPO_JOB_NAME_MAX_LENGTH = 200;

// ── One job view, three surfaces ──────────────────────────────────────────
//
// GET /topo-jobs, GET /topo-jobs/:id and (for the role stamp)
// /completed-overlays all answer the same two questions about a TopoJob row:
// which columns a client is allowed to see, and what a NON-owner is allowed to
// see of them.
//
// Two rules, declared once:
//   - userId NEVER leaves this file. A recipient has no business learning the
//     owner's internal id; the derived syncRole is the whole answer they need.
//   - s3OutputKeys is owner-only. It names raw bucket keys, and a key can name
//     a place (root privacy rule) — so it is stripped for a recipient even on
//     the detail endpoint that owners use to poll for outputs.
//
// A new column reaches clients by being added to TOPO_JOB_SELECT, which forces
// the same decision for every surface at once.

export const TOPO_JOB_SELECT = {
  id: true,
  userId: true, // consumed by serializeTopoJobFor; never emitted
  status: true,
  name: true,
  footprint: true,
  tileCount: true,
  estimatedSeconds: true,
  layerOptions: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** syncRole mirrors the waypoint/route delta convention: a 'shared' row is
 *  read-only on the client. */
function syncRoleFor(row: { userId: string }, callerId: string) {
  return row.userId === callerId ? ("owner" as const) : ("shared" as const);
}

/** The client-facing view of a job row, for owner and recipient alike. Pass a
 *  row selected with TOPO_JOB_SELECT; `s3OutputKeys` is included only when the
 *  caller selected it AND owns the row. */
export function serializeTopoJobFor<
  T extends { userId: string; s3OutputKeys?: unknown },
>(row: T, callerId: string) {
  const { userId, s3OutputKeys, ...rest } = row;
  const isOwner = userId === callerId;
  return {
    ...rest,
    ...(isOwner && s3OutputKeys !== undefined ? { s3OutputKeys } : {}),
    syncRole: syncRoleFor(row, callerId),
  };
}

// Uncompressed input-ZIP cap, the zip-bomb / disk-DoS guard for the Fargate
// worker. A legitimate ELVIS export is ~17 MB compressed LAZ + ~5 MB DEM per
// tile; this sits well above any realistic one while rejecting pathological
// archives before the worker is launched.
const MAX_INPUT_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB
const ECS_TASK_DEFINITION = env.ECS_TOPO_TASK_DEF;
// Non-empty subnet list = launch the worker via RunTask. Local dev sets dummy
// subnets (.env.local) so MiniStack spawns the worker container; an empty list
// disables the launch and leaves the job pending.
const ECS_SUBNETS = env.ECS_SUBNETS_LIST;

// POST /topo-jobs — create job + return presigned S3 upload URL
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const { tileCount, jobName, settings, autoExport } = req.body;

    // Validate jobName is a string and cap it alongside the type check rather
    // than storing whatever fits in the body budget.
    if (jobName !== undefined && jobName !== null) {
      if (typeof jobName !== "string")
        throw malformed("jobName must be a string");
      if (jobName.length > TOPO_JOB_NAME_MAX_LENGTH)
        throw new AppError(
          400,
          say`A LiDAR map's name can be up to ${TOPO_JOB_NAME_MAX_LENGTH} characters.`,
        );
    }

    // Advisory pre-check so an over-allowance user is told before uploading a
    // multi-GB ZIP rather than after. The authoritative, serialised check runs
    // in /start against the server-verified tile count.
    await assertHasCredits(
      user,
      "topo",
      await estimateTopoSeconds(tileCount ?? null),
    );
    await assertHasStorageQuota(user.id);

    // Optional raster template settings: without them the job gets the
    // defaults Logjam Web sends, since the worker has no fallback of its own.
    let layerOptions: object = RASTER_TEMPLATE_DEFAULTS;
    if (settings !== undefined && settings !== null) {
      const validation = validateRasterTemplateSettings(settings);
      if (!validation.ok) {
        throw malformed(
          `Invalid topo settings: ${validation.errors.join("; ")}`,
        );
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
        throw malformed(
          `Invalid auto-export settings: ${validation.errors.join("; ")}`,
        );
      }
      autoExportConfig = validation.value as object;
    }

    // Snapshot the user's live vector style at submission time. The composite
    // raster bake uses this snapshot; in-app display reads the live value
    // independently. Falls back to defaults if the column is null.
    const vectorStyleSnapshot =
      (user.vectorStyle as object | null) ?? VECTOR_STYLE_DEFAULTS;

    const estimatedSeconds = await estimateTopoSeconds(tileCount ?? null);

    const job = await prisma.topoJob.create({
      data: {
        userId: user.id,
        status: "uploading",
        name: jobName ?? null,
        tileCount: tileCount ?? null,
        estimatedSeconds,
        layerOptions,
        autoExport: autoExportConfig ?? undefined,
        vectorStyleSnapshot,
      },
    });

    const s3InputKey = `inputs/${job.id}/upload.zip`;
    await prisma.topoJob.update({
      where: { id: job.id },
      data: { s3InputKey },
    });

    // uploadUrl is the single-PUT path a Logjam Web tab loaded before the
    // multipart client still takes; it can go once that client is everywhere.
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: TOPO_BUCKET,
        Key: s3InputKey,
        ContentType: "application/zip",
      }),
      { expiresIn: 900 }, // 15 minutes
    );
    const { UploadId: uploadId } = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: TOPO_BUCKET,
        Key: s3InputKey,
        ContentType: "application/zip",
      }),
    );

    res.status(201).json({
      jobId: job.id,
      uploadUrl,
      uploadId,
      partSize: TOPO_UPLOAD_PART_BYTES,
    });
  },
);

/** The owner's job, still waiting for its ZIP; the upload id from the body.
 *  The id needs no lookup of its own: S3 ties it to the job's key, so an id
 *  from another job's upload signs nothing here. */
async function ownUploadingJob(req: AuthenticatedRequest) {
  const user = await getUser(req.user!.sub);
  const job = await prisma.topoJob.findUnique({
    where: { id: getParam(req.params.id) },
  });
  if (!job) throw new AppError(404, say`Couldn't find that LiDAR map.`);
  requireShareOwner(
    await getJobRole(user.id, "topoJob", job),
    "topoJob",
    say`Only the owner can upload to this LiDAR map.`,
  );
  if (job.status !== "uploading")
    throw new AppError(400, say`That upload has already been received.`);
  const { uploadId } = req.body ?? {};
  if (typeof uploadId !== "string" || !uploadId || uploadId.length > 1024)
    throw malformed("uploadId must be a non-empty string");
  return { key: job.s3InputKey!, uploadId };
}

// POST /topo-jobs/:id/parts — presigned PUT URLs for parts of the ZIP
router.post(
  "/:id/parts",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { key, uploadId } = await ownUploadingJob(req);
    const { sizeBytes, partNumbers } = req.body;
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1)
      throw malformed("sizeBytes must be a positive integer");
    if (!Array.isArray(partNumbers) || partNumbers.length === 0)
      throw malformed("partNumbers must be a non-empty array");
    if (partNumbers.length > TOPO_UPLOAD_SIGN_MAX)
      throw malformed(
        `At most ${TOPO_UPLOAD_SIGN_MAX} partNumbers per request`,
        413,
      );
    const parts = await signTopoParts(
      TOPO_BUCKET,
      key,
      uploadId,
      sizeBytes,
      partNumbers,
    );
    res.json({ parts });
  },
);

// POST /topo-jobs/:id/complete — join the uploaded parts into the ZIP
router.post(
  "/:id/complete",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { key, uploadId } = await ownUploadingJob(req);
    const { partCount } = req.body;
    if (
      !Number.isInteger(partCount) ||
      partCount < 1 ||
      partCount > TOPO_UPLOAD_MAX_PARTS
    )
      throw malformed("partCount must be an integer in range");
    await joinTopoUpload(TOPO_BUCKET, key, uploadId, partCount);
    res.status(204).send();
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
    if (!job) throw new AppError(404, say`Couldn't find that LiDAR map.`);
    requireShareOwner(
      await getJobRole(user.id, "topoJob", job),
      "topoJob",
      say`Only the owner can start this LiDAR map.`,
    );
    if (job.status !== "uploading")
      throw new AppError(400, say`That upload has already been received.`);

    // Verify the S3 object was actually uploaded
    let objectSize: number;
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: TOPO_BUCKET, Key: job.s3InputKey! }),
      );
      objectSize = head.ContentLength ?? 0;
    } catch {
      throw new AppError(
        400,
        say`That ZIP didn't finish uploading. Try again.`,
      );
    }

    // Reject an oversized upload before reading/extracting it (compressed cap).
    if (objectSize > MAX_INPUT_ZIP_COMPRESSED_BYTES) {
      throw new AppError(
        413,
        say`That ZIP is larger than Logjam can take. Choose a smaller area.`,
      );
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
    let lazCount = 0;
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
          say`That ZIP holds more data than Logjam can process. Choose a smaller area.`,
        );
      }
      verifiedTileCount = zipStats.tileCount || null;
      lazCount = zipStats.lazCount;
    } catch (e) {
      if (e instanceof ElvisZipError) {
        throw new AppError(400, e.sentence);
      }
      throw e;
    }

    // Authoritative quota check against server-counted tiles from the actual
    // ZIP, serialised per user: the user-row lock prevents two
    // concurrent /start calls from both reading the same monthly aggregate and
    // both passing. The job is still "uploading" so it won't appear in the
    // aggregate. RunTask stays outside the transaction (no AWS calls inside
    // DB transactions); the earlier checks above remain advisory pre-checks.
    // Adaptive estimate from server-verified tile count. Computed before the
    // transaction — it's a DB read, kept out of the FOR UPDATE critical section.
    const verifiedEstimate = await estimateTopoSeconds(verifiedTileCount);

    // Account-wide capacity, checked BEFORE the status flip: refusing after the
    // row goes `pending` would leave a job nobody launches, waiting 15 minutes
    // for the reaper to fail it. Deliberately not serialised — it is a coarse
    // ceiling with headroom under the AWS quota, so a rare concurrent overshoot
    // of one task is harmless.
    await assertGlobalCapacity("topo");

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      await assertHasCredits(user, "topo", verifiedEstimate, tx);
      await assertHasStorageQuota(user.id, 0n, tx);
      const flipped = await tx.topoJob.updateMany({
        // Status guard doubles as a double-/start race close: a concurrent
        // second /start finds 0 rows and 400s instead of double-launching.
        where: { id: jobId, status: "uploading" },
        data: {
          status: "pending",
          attemptCount: { increment: 1 },
          ...(SHARPEN_NEW_JOBS
            ? { sharpen: sharpenMark(lazCount, job.layerOptions) }
            : {}),
          ...(verifiedTileCount !== null
            ? {
                tileCount: verifiedTileCount,
                estimatedSeconds: verifiedEstimate,
              }
            : {}),
        },
      });
      if (flipped.count === 0) {
        throw new AppError(400, say`That upload has already been received.`);
      }
    });

    // ECS RunTask owns lifecycle; status column owns retry semantics.
    // launchFargateTask throws on placement failure (`failures[]`
    // populated / no task) as well as on SDK errors, so a launch problem can
    // never strand the job in `pending`.
    if (ECS_SUBNETS.length) {
      try {
        const taskArn = await launchFargateTask({
          taskDefinition: ECS_TASK_DEFINITION,
          containerName: "topo-worker",
          environment: [{ name: "JOB_ID", value: jobId }],
        });
        // Persist the ARN so the reaper / DELETE can StopTask it.
        await prisma.topoJob.update({
          where: { id: jobId },
          data: { ecsTaskArn: taskArn },
        });
      } catch (launchErr) {
        // Do not leak the raw AWS error to the client or the job row; log the
        // reason server-side (no place coords/names involved here).
        logger.error(
          { jobId, reason: String(launchErr) },
          "topo_runtask_failed",
        );
        await prisma.topoJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            errorMessage: say`Couldn't start this LiDAR map. Try again.`,
          },
        });
        throw new AppError(500, say`Couldn't start that LiDAR map. Try again.`);
      }
    }

    res.json({ jobId, status: "pending" });
  },
);

/**
 * What /start writes to `TopoJob.sharpen` to send a job down the sharpen
 * pipeline; the worker replaces it with its result. Vegetation needs point
 * clouds, so it is ticked only for a ZIP that has them.
 */
export function sharpenMark(lazCount: number, layerOptions: unknown) {
  const vegetation = (layerOptions as { vegetation?: { enabled?: unknown } })
    ?.vegetation;
  return { v: 1, vegetation: lazCount > 0 && vegetation?.enabled === true };
}

// GET /topo-jobs — list authenticated user's jobs
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    // Own jobs, plus jobs shared directly with me (read-only there).
    const jobs = await prisma.topoJob.findMany({
      where: {
        OR: [
          { userId: user.id },
          { id: { in: await directlySharedIds(user.id, "topoJob") } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: TOPO_JOB_SELECT,
    });
    res.json(jobs.map((job) => serializeTopoJobFor(job, user.id)));
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
      where: {
        status: "complete",
        OR: [
          { userId: user.id },
          { id: { in: await directlySharedIds(user.id, "topoJob") } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
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
    const expiresAt = new Date(
      Date.now() + presignTtlSeconds * 1000,
    ).toISOString();

    const jobsResult = await Promise.all(
      jobs.map(async (j) => {
        const outputs =
          (j.s3OutputKeys as
            | {
                name: string;
                cogKey: string | null;
                pmtilesKey: string | null;
              }[]
            | null) ?? [];
        const layers = await Promise.all(
          outputs
            .filter(
              (o): o is typeof o & { pmtilesKey: string } =>
                Boolean(o.pmtilesKey) &&
                layerMetaByName.has(o.name as TopoLayerName),
            )
            .map(async (o) => {
              const meta = layerMetaByName.get(o.name as TopoLayerName)!;
              const pmtilesUrl = await getSignedUrl(
                s3,
                new GetObjectCommand({
                  Bucket: TOPO_BUCKET,
                  Key: o.pmtilesKey,
                }),
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
          // Same rule as the job view above — the role is the whole answer,
          // and the owner's internal id is never emitted. This payload is a
          // derived overlay shape rather than a job row, so it stamps the role
          // directly instead of going through serializeTopoJobFor.
          syncRole: syncRoleFor(j, user.id),
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
      select: { ...TOPO_JOB_SELECT, s3OutputKeys: true },
    });
    if (!job) throw new AppError(404, say`Couldn't find that LiDAR map.`);
    // ShareAccess gives a stranger the same 404 a missing id gets, so
    // existence is not confirmed to a guesser.
    requireShareAccess(await getJobRole(user.id, "topoJob", job), "topoJob");
    res.json(serializeTopoJobFor(job, user.id));
  },
);

// All downloads go through POST /topo-exports → the export worker.
// See routes/topoExports.ts.

// DELETE /topo-jobs/:id — delete job and all S3 objects. In-flight jobs are
// cancelled then purged: the row is force-failed (status-guarded)
// so the worker can't complete it mid-delete, the Fargate task is stopped
// best-effort, and only then are the prefixes purged and the row removed.
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const jobId = getParam(req.params.id);
    const job = await prisma.topoJob.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError(404, say`Couldn't find that LiDAR map.`);
    requireShareOwner(
      await getJobRole(user.id, "topoJob", job),
      "topoJob",
      say`Only the owner can delete this LiDAR map.`,
    );

    // A running export is actively reading this job's COGs from
    // outputs/{jobId}/ — refuse until it finishes (no FK on sourceJobIds, so
    // this is the only referential guard).
    const runningExports = await prisma.topoExportJob.count({
      where: { status: "running", sourceJobIds: { has: jobId } },
    });
    if (runningExports > 0) {
      throw new AppError(
        409,
        say`An export of this LiDAR map is running. Try again when it finishes.`,
      );
    }

    if (job.status === "pending" || job.status === "processing") {
      // Cancel: status-guarded flip so a worker that completes between the
      // ownership read and this write wins (its storage charge then matches
      // the fresh outputBytes re-read below). After the flip, the worker's
      // guarded terminal write matches 0 rows and self-cleans, so
      // a missed StopTask only costs Fargate time.
      await prisma.topoJob.updateMany({
        where: { id: jobId, status: { in: ["pending", "processing"] } },
        data: { status: "failed", errorMessage: say`You cancelled this.` },
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
          logger.error(
            { jobId, reason: String(stopErr) },
            "topo_job_delete_stop_task_failed",
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
    if (!fresh) throw new AppError(404, say`Couldn't find that LiDAR map.`);

    // S3-first: delete the objects before the DB row and the quota
    // decrement. deleteS3Prefix throws on failure, so if any prefix fails the
    // row survives and a retried DELETE re-derives the same jobId-keyed prefixes
    // — no orphaned objects, and the quota is only decremented once the bytes
    // are confirmed gone. (decrementStorageUsed clamps at 0 — keep it for that.)
    await deleteTopoJobObjects(TOPO_BUCKET, jobId);

    // One transaction: queued exports referencing this job are
    // force-failed with a clear message (their COG source is about to
    // disappear), and the row delete commits with the quota decrement.
    await prisma.$transaction(async (tx) => {
      await tx.topoExportJob.updateMany({
        where: { status: "queued", sourceJobIds: { has: jobId } },
        data: {
          status: "failed",
          errorMessage: say`A LiDAR map this export needed was deleted before it started.`,
        },
      });
      // Share.entityId is polymorphic, so Postgres cannot cascade: without
      // this the rows outlive the job and keep it in a recipient's list.
      // No tombstone — topo jobs are not delta-synced; the recipient's next
      // GET /topo-jobs simply stops returning it and the client reconciles
      // its downloaded overlay from that.
      await deleteSharesFor(tx, "topoJob", [jobId]);
      await tx.topoJob.delete({ where: { id: jobId } });
      await decrementStorageUsed(job.userId, fresh.outputBytes ?? 0n, tx);
    });

    res.status(204).send();
  },
);

export default router;
