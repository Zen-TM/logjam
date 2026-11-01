// Deleting a LiDAR job's data: its objects, its shares, its row and its
// storage charge. `DELETE /topo-jobs/:id` and the one-off purge of old jobs
// (scripts/purgeLegacyTopoJobs.ts) both go through it; each checks first who
// may delete the job and that no export is reading it.
import { say } from "@logjam/shared";

import prisma from "../services/prisma";
import { getEnv } from "./env";
import { deleteSharesFor } from "./shareAccess";
import { decrementStorageUsed } from "./storageQuota";
import { deleteTopoJobObjects } from "./topoUpload";

const TOPO_BUCKET = getEnv().S3_BUCKET_TOPO ?? "";

/**
 * Delete a job's data, or return false when the row is already gone.
 *
 * S3 first: if any prefix fails to delete, this throws with the row intact,
 * so a retry re-derives the same jobId-keyed prefixes, nothing is orphaned,
 * and the quota is decremented only once the bytes are gone
 * (`decrementStorageUsed` clamps at 0). `outputBytes` is re-read here: a
 * worker that completed after the caller's read must be the charge undone.
 */
export async function deleteTopoJob(
  jobId: string,
  userId: string,
): Promise<boolean> {
  const fresh = await prisma.topoJob.findUnique({
    where: { id: jobId },
    select: { outputBytes: true },
  });
  if (!fresh) return false;
  await deleteTopoJobObjects(TOPO_BUCKET, jobId);

  // One transaction: queued exports referencing this job are force-failed
  // with a clear message (their source is about to disappear), and the row
  // delete commits with the quota decrement.
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
    await decrementStorageUsed(userId, fresh.outputBytes ?? 0n, tx);
  });
  return true;
}
