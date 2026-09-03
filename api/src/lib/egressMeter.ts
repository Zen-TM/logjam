import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { getEnv } from "./env";
import { logger, safeErrorForLog } from "./logger";
import { sendPushToUser } from "../services/push";
import {
  currentMonthStart,
  QUOTA_WARNING_FRACTION,
} from "@logjam/shared";
import {
  parseAccessLog,
  isBillableEgress,
  attributeKey,
  type KeyAttribution,
} from "./s3AccessLog";

/**
 * Monthly egress meter.
 *
 * Reads S3 server access logs, keeps only the records that represent a user
 * download (see isBillableEgress), attributes each object's bytes to the user
 * who owns it, and accumulates the total on that user's row.
 *
 * WHY LOGS AND NOT THE REQUEST PATH: the API hands out presigned GET URLs far
 * more often than they are fetched — lib/mediaPresign.ts signs one per photo on
 * every canyon read, and the exports list re-signs all 50 rows on every poll —
 * so charging when a URL is minted would over-count enormously. The access log
 * is the only record of bytes that actually moved.
 *
 * The cost of that choice is latency: delivery is best-effort and can lag by
 * hours, so this is an after-the-fact backstop against a sustained drain, not a
 * gate that stops the first burst.
 *
 * The sweep rides the topo reaper's interval (lib/topoJobReaper.ts).
 */

/** Log prefixes, matching `target_prefix` on each bucket's logging config in
 * infra/terraform/envs/prod/s3.tf. */
const LOG_PREFIXES = ["media/", "topo-jobs/"] as const;

type Attribution = { userId: string; bytes: number };

/**
 * Resolve job-owned keys to their owners in three batched queries rather than
 * one per record — a single log object routinely holds thousands of lines.
 */
async function resolveOwners(
  attributions: KeyAttribution[],
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  const byTable = {
    topoJob: new Set<string>(),
    topoExportJob: new Set<string>(),
    geoPdfJob: new Set<string>(),
  };

  for (const attribution of attributions) {
    if (attribution.kind === "job") byTable[attribution.table].add(attribution.jobId);
  }

  const [topoJobs, exportJobs, geoPdfJobs] = await Promise.all([
    byTable.topoJob.size
      ? prisma.topoJob.findMany({
          where: { id: { in: [...byTable.topoJob] } },
          select: { id: true, userId: true },
        })
      : [],
    byTable.topoExportJob.size
      ? prisma.topoExportJob.findMany({
          where: { id: { in: [...byTable.topoExportJob] } },
          select: { id: true, userId: true },
        })
      : [],
    byTable.geoPdfJob.size
      ? prisma.geoPdfJob.findMany({
          where: { id: { in: [...byTable.geoPdfJob] } },
          select: { id: true, userId: true },
        })
      : [],
  ]);

  for (const row of [...topoJobs, ...exportJobs, ...geoPdfJobs]) {
    owners.set(row.id, row.userId);
  }
  return owners;
}

/**
 * Sum billable bytes per user for one batch of log contents.
 *
 * A job row that no longer exists (deleted job, deleted account) resolves to no
 * owner and its bytes are dropped. Deliberate: there is nobody left to charge,
 * and inventing an attribution would be worse than under-counting.
 */
export async function tallyLogContents(contents: string[]): Promise<Map<string, bigint>> {
  const env = getEnv();
  const pattern = env.EGRESS_API_REQUESTER_PATTERN;

  const pending: { attribution: KeyAttribution; bytes: number }[] = [];
  for (const body of contents) {
    for (const record of parseAccessLog(body)) {
      if (!isBillableEgress(record, pattern)) continue;
      const attribution = attributeKey(record.key);
      if (attribution === null) continue;
      pending.push({ attribution, bytes: record.bytesSent });
    }
  }

  const owners = await resolveOwners(pending.map((p) => p.attribution));

  const totals = new Map<string, bigint>();
  for (const { attribution, bytes } of pending) {
    const userId =
      attribution.kind === "user" ? attribution.userId : owners.get(attribution.jobId);
    if (userId === undefined) continue;
    totals.set(userId, (totals.get(userId) ?? 0n) + BigInt(bytes));
  }
  return totals;
}

/**
 * Add `bytes` to a user's monthly egress, rolling the period over first if the
 * stored period start belongs to a past month.
 *
 * The reset is lazy — done here rather than by a scheduled job that would have
 * to touch every user at midnight on the 1st. One statement so a concurrent
 * sweep cannot read-modify-write over the top of this one.
 */
async function addEgress(userId: string, bytes: bigint): Promise<void> {
  const monthStart = currentMonthStart();
  await prisma.$executeRaw`
    UPDATE users
    SET
      monthly_egress_used_bytes = CASE
        WHEN egress_period_start < ${monthStart} THEN ${bytes}
        ELSE monthly_egress_used_bytes + ${bytes}
      END,
      egress_period_start = CASE
        WHEN egress_period_start < ${monthStart} THEN ${monthStart}
        ELSE egress_period_start
      END
    WHERE id = ${userId}::uuid
  `;
}

/**
 * Tell the user once per month per threshold that they are near, or out of,
 * their download allowance.
 *
 * There is no progress bar for egress anywhere in the UI — the cap sits far
 * above real use, so surfacing it permanently would be noise. These two
 * notifications are the entire user-facing surface, which is why the dedup
 * matters: the sweep runs every few minutes and would otherwise re-notify on
 * every pass for the rest of the month.
 */
async function notifyThreshold(
  userId: string,
  used: bigint,
  quota: bigint,
): Promise<void> {
  if (quota <= 0n) return;

  const exhausted = used >= quota;
  const warning =
    !exhausted && Number(used) >= Number(quota) * QUOTA_WARNING_FRACTION;
  if (!exhausted && !warning) return;

  const type = exhausted ? "egress_quota_exceeded" : "egress_quota_warning";

  // Once per user per type per month. Cheap because it only runs for users
  // already in the warning band, which is approximately nobody.
  const existing = await prisma.notification.findFirst({
    where: { userId, type, createdAt: { gte: currentMonthStart() } },
    select: { id: true },
  });
  if (existing) return;

  // Payload carries no keys, filenames or canyon references — just the two
  // numbers needed to render the message. BigInt is stringified because JSON
  // columns cannot hold it and the values exceed Number's safe range in
  // principle.
  await prisma.notification.create({
    data: {
      userId,
      type,
      payload: { usedBytes: used.toString(), quotaBytes: quota.toString() },
    },
  });
  // Best-effort push, generic by design — no numbers, matching how every other
  // push in this codebase carries a type and opaque ids only.
  await sendPushToUser(userId, { type });
}

/**
 * Consume newly delivered access-log objects for one prefix, resuming from the
 * stored cursor.
 *
 * Access-log keys embed a UTC timestamp and so sort lexicographically by time,
 * which is what makes `StartAfter` a valid resume point and saves a
 * per-object bookkeeping table.
 *
 * KNOWN CEILING: delivery is best-effort AND can be out of order, so an object
 * delivered under a key sorting before the cursor is never read. That
 * under-counts and never over-counts — the correct direction for a limit that
 * refuses service.
 */
async function sweepPrefix(bucket: string, prefix: string, maxObjects: number) {
  const cursor = await prisma.egressLogCursor.findUnique({ where: { prefix } });

  const listing = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      StartAfter: cursor?.lastKey,
      MaxKeys: maxObjects,
    }),
  );

  const keys = (listing.Contents ?? [])
    .map((object) => object.Key)
    .filter((key): key is string => Boolean(key))
    .sort();
  if (keys.length === 0) return { objects: 0, users: 0 };

  const contents: string[] = [];
  for (const key of keys) {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    contents.push((await object.Body?.transformToString()) ?? "");
  }

  const totals = await tallyLogContents(contents);

  for (const [userId, bytes] of totals) {
    await addEgress(userId, bytes);
  }

  // Advance the cursor only after the bytes are committed. A crash in between
  // re-reads these objects next sweep and double-counts them; the reverse
  // ordering would lose them silently. Over-counting a user's downloads is
  // recoverable (the month rolls over), losing the record of them is not.
  await prisma.egressLogCursor.upsert({
    where: { prefix },
    create: { prefix, lastKey: keys[keys.length - 1] },
    update: { lastKey: keys[keys.length - 1] },
  });

  // Notify against the freshly written totals.
  if (totals.size > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: [...totals.keys()] } },
      select: {
        id: true,
        monthlyEgressUsedBytes: true,
        monthlyEgressQuotaBytes: true,
      },
    });
    for (const user of users) {
      await notifyThreshold(
        user.id,
        user.monthlyEgressUsedBytes,
        user.monthlyEgressQuotaBytes,
      ).catch((err) => {
        logger.warn({ err: safeErrorForLog(err) }, "egress_quota_notify_failed");
      });
    }
  }

  return { objects: keys.length, users: totals.size };
}

/** One full pass over both log prefixes. Safe to call concurrently with itself
 * only in the sense that it will double-count, not corrupt — the reaper calls
 * it serially. */
export async function sweepEgress(): Promise<void> {
  const env = getEnv();
  const bucket = env.S3_BUCKET_ACCESS_LOGS;
  if (bucket === "") return;

  for (const prefix of LOG_PREFIXES) {
    try {
      const result = await sweepPrefix(
        bucket,
        prefix,
        env.EGRESS_MAX_LOG_OBJECTS_PER_SWEEP,
      );
      if (result.objects > 0) {
        logger.info(
          { prefix, objects: result.objects, users: result.users },
          "egress_sweep_processed",
        );
      }
    } catch (err) {
      // One prefix failing must not stop the other. No key or user id in the
      // log line — this is an infrastructure error, not user data.
      logger.error({ prefix, err: safeErrorForLog(err) }, "egress_sweep_failed");
    }
  }
}
