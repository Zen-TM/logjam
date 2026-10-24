// The one-off deletion of old LiDAR jobs: every finished job from before new
// jobs sharpened their area (`sharpen` null), with its objects, its shares,
// its row and its storage charge, as `DELETE /topo-jobs/:id` deletes one
// (lib/deleteTopoJob.ts). The maintainer decided they go with no notice
// (beta, no data guarantee before release).
//
//   node dist/scripts/purgeLegacyTopoJobs.js          # counts, deletes nothing
//   node dist/scripts/purgeLegacyTopoJobs.js --yes    # deletes
//
// In prod it runs as an announcement does, a one-off task on the live API
// image (docs/operations/announcements.md, "In prod"), with this command.
//
// Only `complete` and `failed` rows. An `uploading` row may be a new job not
// yet started (`/start` writes its mark), and a `pending` or `processing` one
// is a worker's to finish or the reaper's to fail: both are counted, never
// deleted. A job a running export reads is skipped, as DELETE refuses it.
//
// Logs say job ids and counts, never a place: a job id names no area.
import { Prisma } from "@prisma/client";

import { deleteTopoJob } from "../lib/deleteTopoJob";
import { logger, safeErrorForLog } from "../lib/logger";
import prisma from "../services/prisma";

const FINISHED = ["complete", "failed"];

/** Counts the old jobs; with `confirmed`, deletes them. Returns the exit code. */
export async function purge(confirmed: boolean): Promise<number> {
  const legacy = await prisma.topoJob.findMany({
    where: { sharpen: { equals: Prisma.DbNull } },
    select: { id: true, userId: true, status: true, outputBytes: true },
  });
  const finished = legacy.filter((job) => FINISHED.includes(job.status));
  const exporting = new Set(
    (
      await prisma.topoExportJob.findMany({
        where: {
          status: "running",
          sourceJobIds: { hasSome: finished.map((job) => job.id) },
        },
        select: { sourceJobIds: true },
      })
    ).flatMap((exportJob) => exportJob.sourceJobIds),
  );
  const doomed = finished.filter((job) => !exporting.has(job.id));
  logger.info(
    {
      jobs: doomed.length,
      owners: new Set(doomed.map((job) => job.userId)).size,
      outputBytes: doomed
        .reduce((sum, job) => sum + (job.outputBytes ?? 0n), 0n)
        .toString(),
      skippedUnfinished: legacy.length - finished.length,
      skippedExporting: finished.length - doomed.length,
    },
    confirmed ? "legacy_topo_jobs_purging" : "legacy_topo_jobs_checked",
  );
  if (!confirmed) return 0;

  let deleted = 0;
  let failed = 0;
  for (const job of doomed) {
    try {
      // False: deleted meanwhile (its owner, from a client), which is done.
      if (await deleteTopoJob(job.id, job.userId)) deleted += 1;
    } catch (err) {
      // The row stays with its objects (S3 first), so a rerun picks it up.
      failed += 1;
      logger.error(
        { jobId: job.id, err: safeErrorForLog(err) },
        "legacy_topo_job_purge_failed",
      );
    }
  }
  logger.info({ deleted, failed }, "legacy_topo_jobs_purged");
  return failed > 0 ? 1 : 0;
}

async function main(args: string[]): Promise<number> {
  if (args.every((arg) => arg === "--yes")) return purge(args.length > 0);
  logger.error("usage: purgeLegacyTopoJobs.js [--yes]");
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (err) => {
      logger.error({ err: safeErrorForLog(err) }, "legacy_topo_purge_failed");
      await prisma.$disconnect();
      process.exit(1);
    });
}
