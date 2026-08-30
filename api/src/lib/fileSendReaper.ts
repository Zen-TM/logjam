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
    select: {
      id: true,
      senderId: true,
      s3Key: true,
      sizeBytes: true,
      // Stamped onto the notifications of recipients who never took it — see
      // the claim block below.
      filename: true,
      // Who took the copy, so the notifications can be settled below.
      recipients: { select: { userId: true, status: true } },
    },
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
          // THIS IS THE LAST MOMENT ANYONE KNOWS WHO TOOK THE FILE. Deleting
          // the send takes the recipient rows with it, and from then on a
          // surviving `file_sent` notification means exactly one thing —
          // "expired before it was saved" — which is what lets the inbox keep
          // explaining it forever without storing the filename anywhere
          // (notifications.ts, PRIV-005). Settling it here is what makes that
          // inference true: a recipient who ALREADY HAS the file is told
          // nothing, because their notification goes now.
          //
          // Decline and unfriend already delete the row and its notification
          // together, so neither can be mistaken for this.
          const saved = row.recipients
            .filter((recipient) => recipient.status === "accepted")
            .map((recipient) => recipient.userId);
          if (saved.length > 0) {
            await tx.notification.deleteMany({
              where: {
                userId: { in: saved },
                type: "file_sent",
                payload: { path: ["fileSendId"], equals: row.id },
              },
            });
          }

          // THE ONE PLACE A FILENAME IS WRITTEN INTO A PAYLOAD, and the only
          // one that may be. Everywhere else these notifications resolve their
          // filename from the live send at read time (PRIV-005), because a
          // filename is user text that routinely names a canyon and must not
          // sit at rest for something the reader can no longer reach. That
          // reasoning runs out here: the row about to be deleted is the last
          // copy, and a recipient who never got the file is owed the name of
          // the thing they missed — "bob sent you a file" is not enough to ask
          // him to send it again.
          //
          // Scoped as tightly as the exception allows: only recipients who did
          // NOT take it (the ones above have theirs deleted instead), only at
          // expiry, and only ever this one field. A live send still resolves.
          const missed = row.recipients
            .filter((recipient) => recipient.status !== "accepted")
            .map((recipient) => recipient.userId);
          if (missed.length > 0) {
            const stranded = await tx.notification.findMany({
              where: {
                userId: { in: missed },
                type: "file_sent",
                payload: { path: ["fileSendId"], equals: row.id },
              },
              select: { id: true, payload: true },
            });
            for (const notification of stranded) {
              await tx.notification.update({
                where: { id: notification.id },
                data: {
                  payload: {
                    ...(notification.payload as object),
                    filename: row.filename,
                  },
                },
              });
            }
          }
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
