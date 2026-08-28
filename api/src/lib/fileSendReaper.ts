// Expiry sweep for "send a copy" file handoffs.
//
// Sent bytes are meant to disappear on their own: the S3 lifecycle rule on the
// `file-sends/` prefix removes the objects, and this sweep removes the rows and
// REFUNDS THE SENDER'S QUOTA. The refund is the part that cannot be skipped — a
// sender whose quota is charged at upload and never credited back slowly loses
// their allowance to files nobody can even see any more.
//
// Nothing else deletes a send. Accept and decline move one recipient row to a
// terminal status and stop there; see routes/fileSends.ts for why the obvious
// "delete the object once they've got it" is wrong.
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { getEnv } from "./env";
import { logger, safeErrorForLog } from "./logger";
import { decrementStorageUsed } from "./storageQuota";

/**
 * Delete every expired send, refunding each sender exactly once.
 *
 * The double-refund guard is the DELETE ITSELF, not a status column: two API
 * instances sweeping the same row both issue `deleteMany`, Postgres serialises
 * them, and the loser sees `count === 0` and refunds nothing. This is the
 * claim-marker pattern from root CLAUDE.md with the row's own existence as the
 * marker — no extra column, same guarantee.
 *
 * Per-row failures are logged and skipped so one bad row cannot wedge the rest
 * (the convention expireCompletedExports follows).
 */
export async function sweepExpiredFileSends(
  now: Date = new Date(),
): Promise<number> {
  const bucket = getEnv().S3_BUCKET_MEDIA ?? "";

  const expired = await prisma.fileSend.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, senderId: true, s3Key: true, sizeBytes: true },
  });

  let swept = 0;
  for (const row of expired) {
    try {
      // S3 first (Design Q delete ordering). DeleteObject succeeds on a missing
      // key, so the lifecycle rule having already removed it is harmless; an S3
      // failure leaves the row for the next sweep rather than losing the refund.
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: row.s3Key }),
      );
      await prisma.$transaction(async (tx) => {
        // Claim by deleting. Only the instance that actually removed the row
        // refunds — see the header.
        const { count } = await tx.fileSend.deleteMany({
          where: { id: row.id },
        });
        if (count === 1) {
          await decrementStorageUsed(row.senderId, row.sizeBytes, tx);
        }
      });
      swept += 1;
    } catch (err) {
      // No filename, no recipient ids — a send's filename is user text and the
      // row id is enough to find it.
      logger.error({ err: safeErrorForLog(err), id: row.id }, "file_send_expiry_failed");
    }
  }
  return swept;
}
