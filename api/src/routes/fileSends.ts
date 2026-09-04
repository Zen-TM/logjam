// "Send a copy" — handing a friend a file, not sharing a row.
//
// The distinction this file exists to keep: routes/shares.ts grants a LIVE,
// REVOCABLE view of something the sender still owns. A send is a COPY. Once a
// recipient accepts, the file is theirs — permanent, editable, and impossible
// to take back. No endpoint here revokes anything, and none should ever be
// added: "unsend" is a promise the design cannot keep.
//
// Shape: ONE S3 object per send, however many recipients, charged to the
// sender's quota once. Per-recipient state lives in FileSendRecipient.
//
// Three phases, mirroring routes/media.ts: presign (validate, sign a bounded
// PUT, no row), upload (client → S3 directly), confirm (HeadObject for the
// authoritative size, charge quota, create the rows). An abandoned presign
// leaves an orphan blob that the S3 lifecycle rule on `file-sends/` collects —
// which is why this needs no orphan sweeper of its own.
import { Router, Response } from "express";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";

import { HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { s3 } from "../services/awsClients";
import { getEnv } from "../lib/env";
import { assertHasEgressQuota } from "../lib/egressQuota";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import { parseFriendRecipientIds } from "../lib/friendRecipients";
import { parseClientSuppliedId } from "../lib/clientSuppliedId";
import { logger } from "../lib/logger";
import { sendPushToUser } from "../services/push";
import { deleteS3KeysBestEffort } from "../lib/s3Cleanup";
import {
  assertHasStorageQuota,
  getStorageUsage,
  incrementStorageUsed,
} from "../lib/storageQuota";
import {
  assertSendableSize,
  canRecipientDownload,
  fileSendExpiresAt,
  fileSendKey,
  inboxWhere,
  isMissingObjectError,
  sanitizeSendFilename,
  sendableExtension,
} from "../lib/fileSendAccess";
import {
  FILE_SEND_MAX_BYTES,
  FILE_SEND_SOURCE_KINDS,
  normalizeUserUiPreferences,
  type FileSendSourceKind,
} from "@logjam/shared";

const router = Router();

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";
const UPLOAD_URL_TTL_SECONDS = 900; // 15 minutes, as media uses
const DOWNLOAD_URL_TTL_SECONDS = 3600; // 1 hour, as mediaPresign uses

/** At most this many friends per send — a bound, not a product decision. */
const MAX_RECIPIENTS_PER_SEND = 25;

function parseSourceKind(value: unknown): FileSendSourceKind {
  const match = FILE_SEND_SOURCE_KINDS.find((kind) => kind === value);
  if (!match) throw new AppError(400, "Unknown sourceKind");
  return match;
}

/**
 * The recipient ids for a send, validated as accepted friends.
 *
 * The rule and its anti-oracle ordering live in lib/friendRecipients.ts —
 * bulk sharing is the second caller and neither may drift from the other.
 * Only the wording is this verb's own: a send is not a share.
 */
async function parseRecipientIds(
  senderId: string,
  value: unknown,
): Promise<string[]> {
  return parseFriendRecipientIds({
    senderId,
    value,
    maxRecipients: MAX_RECIPIENTS_PER_SEND,
    tooManyMessage: `A file can be sent to at most ${MAX_RECIPIENTS_PER_SEND} friends at once`,
    selfMessage: "You cannot send a file to yourself",
    notFriendsMessage: "You can only send files to friends",
  });
}

// ── POST /file-sends/presign ──────────────────────────────────
// Validate the send and return a bounded presigned PUT. No row yet.
router.post(
  "/presign",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const body = req.body ?? {};

    const filename = sanitizeSendFilename(body.filename);
    const extension = sendableExtension(filename);
    const sizeBytes = assertSendableSize(body.sizeBytes);
    parseSourceKind(body.sourceKind);
    // Fail fast on a non-friend before signing anything; confirm re-checks.
    await parseRecipientIds(user.id, body.recipientIds);
    // Headroom pre-check; the authoritative charge happens at confirm against
    // the real S3 size.
    await assertHasStorageQuota(user.id, BigInt(sizeBytes));

    const fileSendId = randomUUID();
    // ContentLength is SIGNED into the URL, so S3 itself rejects an upload
    // larger than the declaration (SEC-003, as media presign does).
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: fileSendKey(user.id, fileSendId, extension),
        ContentLength: sizeBytes,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    res.status(201).json({ fileSendId, uploadUrl });
  },
);

// ── POST /file-sends/:id/confirm ──────────────────────────────
// The upload landed: charge the sender once, create the send and its recipient
// rows, notify.
router.post(
  "/:id/confirm",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const fileSendId = getParam(req.params.id);
    const body = req.body ?? {};

    const filename = sanitizeSendFilename(body.filename);
    const extension = sendableExtension(filename);
    const sourceKind = parseSourceKind(body.sourceKind);
    const recipientIds = await parseRecipientIds(user.id, body.recipientIds);
    // Which BULK action this send was one file of, if any. An opaque uuid the
    // client mints per action and stamps on every notification that action
    // creates — the inbox groups on it, so ten files sent in one go collapse to
    // one expandable row instead of ten (lib/bulkShare.ts). An id and nothing
    // else, like every other payload field: it names nothing (PRIV-005).
    const batchId = parseClientSuppliedId(body.batchId, "batchId");

    // Idempotent confirm: a retried request returns the existing send rather
    // than charging quota twice. A foreign id is 404, never 403 — the id came
    // from a client and 403 would confirm it exists (anti-oracle, the rule
    // lib/clientSuppliedId.ts states).
    const existing = await prisma.fileSend.findUnique({
      where: { id: fileSendId },
      include: { recipients: { select: { userId: true, status: true } } },
    });
    if (existing) {
      if (existing.senderId !== user.id) {
        throw new AppError(404, "That file isn't available any more.");
      }
      res.status(200).json(toSentView(existing));
      return;
    }

    const key = fileSendKey(user.id, fileSendId, extension);

    // Authoritative size from S3 — never the client's declared number.
    let sizeBytes: number;
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }),
      );
      sizeBytes = head.ContentLength ?? 0;
    } catch {
      throw new AppError(400, "File has not been uploaded yet");
    }
    if (sizeBytes > FILE_SEND_MAX_BYTES) {
      await deleteS3KeysBestEffort(MEDIA_BUCKET, [key]);
      const limitMb = Math.round(FILE_SEND_MAX_BYTES / 1024 / 1024);
      throw new AppError(413, `A sent file must be under ${limitMb} MB`);
    }

    const totalBytes = BigInt(sizeBytes);
    const expiresAt = fileSendExpiresAt();

    const recipientPrefs = await prisma.user.findMany({
      where: { id: { in: recipientIds } },
      select: { id: true, uiPreferences: true },
    });
    const notifiable = new Set(
      recipientPrefs
        .filter(
          (row) =>
            normalizeUserUiPreferences(row.uiPreferences).notifications
              .shareInApp,
        )
        .map((row) => row.id),
    );

    let send;
    try {
      send = await prisma.$transaction(async (tx) => {
        // Charge, then verify — an over-quota throw rolls the charge back
        // rather than needing a manual decrement (the pattern media confirm
        // uses).
        await incrementStorageUsed(user.id, totalBytes, tx);
        const { used, quota } = await getStorageUsage(user.id, tx);
        if (used > quota) {
          throw new AppError(507, "Storage quota exceeded", {
            used: used.toString(),
            quota: quota.toString(),
          });
        }
        const created = await tx.fileSend.create({
          data: {
            id: fileSendId,
            senderId: user.id,
            sourceKind,
            filename,
            s3Key: key,
            sizeBytes: totalBytes,
            expiresAt,
            recipients: {
              create: recipientIds.map((userId) => ({ userId })),
            },
          },
          include: { recipients: { select: { userId: true, status: true } } },
        });
        // IDs ONLY in the payload — never the filename, which is user text and
        // routinely names a canyon (PRIV-005). The sender's username AND the
        // filename are both resolved from the live rows at read time in
        // notifications.ts, which is also what makes them vanish when the send
        // is declined or expires.
        await tx.notification.createMany({
          data: recipientIds
            .filter((id) => notifiable.has(id))
            .map((id) => ({
              userId: id,
              type: "file_sent",
              payload: {
                fileSendId,
                sentById: user.id,
                ...(batchId ? { batchId } : {}),
              },
            })),
        });
        return created;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // A concurrent duplicate confirm won the race: this transaction rolled
        // back (nothing double-charged) — return the winner's row, as the
        // idempotent path above does. Without this the loser 500s on a send
        // that succeeded.
        const winner = await prisma.fileSend.findUnique({
          where: { id: fileSendId },
          include: { recipients: { select: { userId: true, status: true } } },
        });
        if (winner && winner.senderId === user.id) {
          res.status(200).json(toSentView(winner));
          return;
        }
      }
      if (err instanceof AppError && err.statusCode === 507) {
        await deleteS3KeysBestEffort(MEDIA_BUCKET, [key]);
      }
      throw err;
    }

    // ONE PUSH PER BULK ACTION, NOT PER FILE. Inside a batch this confirm stays
    // silent and POST /bulk-share fires a single push per recipient once the
    // whole action lands — the client calls it LAST, after every upload, so the
    // buzz arrives when the files actually have. Ten files in one go used to be
    // ten buzzes on the recipient's phone, which is where bulk sharing actually
    // hurts them; the ten inbox ROWS are fine, and are what keeps each file
    // individually answerable.
    if (!batchId) {
      for (const id of recipientIds) {
        if (notifiable.has(id)) {
          // Best-effort push after commit; generic title + opaque id only.
          void sendPushToUser(id, { type: "file_sent", fileSendId });
        }
      }
    }

    res.status(201).json(toSentView(send));
  },
);

type SendRow = {
  id: string;
  sourceKind: string;
  filename: string;
  sizeBytes: bigint;
  createdAt: Date;
  expiresAt: Date;
  recipients: { userId: string; status: string }[];
};

/** The sender's view of their own send. */
function toSentView(send: SendRow) {
  return {
    id: send.id,
    sourceKind: send.sourceKind,
    filename: send.filename,
    sizeBytes: Number(send.sizeBytes),
    createdAt: send.createdAt,
    expiresAt: send.expiresAt,
    recipients: send.recipients,
  };
}

// ── GET /file-sends/inbox ─────────────────────────────────────
// Files friends have sent me and I have not yet turned down. Expired sends are
// excluded here as well as at download: the sweep is periodic, so a row can
// outlive its usefulness by up to one sweep interval.
router.get(
  "/inbox",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const rows = await prisma.fileSendRecipient.findMany({
      where: inboxWhere(user.id, new Date()),
      include: {
        fileSend: {
          select: {
            id: true,
            sourceKind: true,
            filename: true,
            sizeBytes: true,
            createdAt: true,
            expiresAt: true,
            // Username only — email on a friends surface is a regression
            // (root CLAUDE.md).
            sender: { select: { id: true, username: true } },
          },
        },
      },
      orderBy: { fileSend: { createdAt: "desc" } },
    });

    res.json(
      rows.map((row) => ({
        fileSendId: row.fileSend.id,
        status: row.status,
        sourceKind: row.fileSend.sourceKind,
        filename: row.fileSend.filename,
        sizeBytes: Number(row.fileSend.sizeBytes),
        createdAt: row.fileSend.createdAt,
        expiresAt: row.fileSend.expiresAt,
        sentBy: row.fileSend.sender,
      })),
    );
  },
);

// ── GET /file-sends/sent ──────────────────────────────────────
// What I have sent and who has picked it up.
router.get(
  "/sent",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const rows = await prisma.fileSend.findMany({
      where: { senderId: user.id },
      include: {
        recipients: {
          select: {
            status: true,
            respondedAt: true,
            user: { select: { id: true, username: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      rows.map((row) => ({
        id: row.id,
        sourceKind: row.sourceKind,
        filename: row.filename,
        sizeBytes: Number(row.sizeBytes),
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        recipients: row.recipients,
      })),
    );
  },
);

/**
 * The filter that finds a caller's OWN recipient row for a send.
 *
 * Exported and pure so the boundary has a test: `userId` is what stops a user
 * reaching a send addressed to somebody else. Keyed on the pair, never on
 * `fileSendId` alone — that mistake would let anyone with an id accept a
 * stranger's file.
 */
export function recipientRowWhere(userId: string, fileSendId: string) {
  return { userId, fileSendId };
}

/**
 * The recipient's own row for a send, or 404.
 *
 * A user who is not a recipient gets exactly what a non-existent id gets, so
 * the status cannot confirm that a send exists to someone it was not sent to.
 *
 * THE MESSAGE IS PART OF THAT. Every 404 on this surface says the same thing —
 * not yours, never existed, expired, bytes gone — because a message that named
 * the reason would tell a stranger probing an id that the id is real. It reads
 * as user-facing copy ("File send not found" reached a toast verbatim, and
 * "file send" is an internal word) while staying a single undifferentiated
 * answer.
 */
async function loadRecipientRow(userId: string, fileSendId: string) {
  const row = await prisma.fileSendRecipient.findFirst({
    where: recipientRowWhere(userId, fileSendId),
    include: { fileSend: true },
  });
  if (!row) throw new AppError(404, "That file isn't available any more.");
  return row;
}

// ── POST /file-sends/:id/accept ───────────────────────────────
// Take the copy: mark accepted and hand back a presigned GET.
router.post(
  "/:id/accept",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const fileSendId = getParam(req.params.id);
    const row = await loadRecipientRow(user.id, fileSendId);

    // The gate is THIS ROW, never whether the object exists: one object serves
    // every recipient, so a decline has to be a fact about the person. A
    // declined recipient is refused while the same bytes stay downloadable for
    // everyone else on the send.
    if (!canRecipientDownload(row, row.fileSend)) {
      throw new AppError(404, "That file isn't available any more.");
    }

    // Deliberately NOT deleting the object here, and there is no "everyone has
    // accepted, clean up" branch either. One object serves every recipient, so
    // deleting on the first accept strands the rest of the send. The bytes go
    // when the S3 lifecycle rule expires them and lib/fileSendReaper.ts sweeps
    // the rows.
    if (row.status === "pending") {
      await prisma.fileSendRecipient.update({
        where: { id: row.id },
        data: { status: "accepted", respondedAt: new Date() },
      });
    }

    // DO NOT PROMISE BYTES THAT ARE NOT THERE. Everything above this point is
    // a database answer, and the database is not the authority on whether the
    // object still exists: the S3 lifecycle rule removes it on its own schedule
    // ("at least" N days, not exactly N), an operator can delete it, and a
    // restored database can point at a bucket that never held it. Without this
    // check the recipient is handed a signed URL that 404s, gets "Couldn't save
    // that file", and can retry it forever — which is exactly what a wiped
    // local bucket produced on 2026-08-30.
    //
    // The prod ordering is still the primary guard and is unchanged: the
    // lifecycle rule is deliberately one day LONGER than FILE_SEND_TTL_DAYS
    // (infra/terraform/envs/prod/s3.tf) so the row, its notification and its
    // buttons all go first. This is the belt to that braces — it turns "an
    // offer that always fails" into "the offer is withdrawn".
    try {
      await s3.send(
        new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: row.fileSend.s3Key }),
      );
    } catch (err) {
      // Only a definitively ABSENT object retires the send. A throttle or a
      // permission fault is transient and must stay retryable, so it falls
      // through to the error handler as a 5xx.
      if (!isMissingObjectError(err)) throw err;
      // Expire the send rather than special-casing this state anywhere else:
      // `expiresAt` in the past is already what every filter reads — the inbox
      // list, the notification resolve (so the row and its buttons disappear
      // for EVERY recipient, not just this one), `canRecipientDownload`, and
      // the reaper, which then refunds the sender for bytes they are no longer
      // storing. One true fact, and the existing machinery does the rest.
      await prisma.fileSend.update({
        where: { id: row.fileSend.id },
        data: { expiresAt: new Date() },
      });
      logger.warn({ fileSendId }, "file_send_object_missing");
      // The same 404 a stranger's id gets: nothing here may confirm more.
      throw new AppError(404, "That file isn't available any more.");
    }

    // The sender's allowance pays for this: the object lives under
    // file-sends/<senderId>/ and S3 attributes it to them. Charging the
    // recipient would let anyone drain a stranger's allowance by repeatedly
    // accepting what that stranger sent.
    await assertHasEgressQuota(row.fileSend.senderId);

    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: row.fileSend.s3Key,
        // Already stripped of quotes and control characters when it was stored
        // (lib/fileSendAccess.ts) — the same treatment lib/mediaPresign.ts
        // applies for the same reason.
        ResponseContentDisposition: `attachment; filename="${row.fileSend.filename}"`,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );

    logger.info({ fileSendId }, "file_send_accepted");
    res.json({ downloadUrl, filename: row.fileSend.filename });
  },
);

// ── POST /file-sends/:id/decline ──────────────────────────────
// Turn it down. Terminal for this recipient and NOTHING ELSE — the object and
// every other recipient's row are untouched.
router.post(
  "/:id/decline",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const fileSendId = getParam(req.params.id);
    const row = await loadRecipientRow(user.id, fileSendId);

    await prisma.$transaction(async (tx) => {
      await tx.fileSendRecipient.update({
        where: { id: row.id },
        data: { status: "declined", respondedAt: new Date() },
      });
      // Drop the recipient's own notification, as share revoke does — the
      // read-time filter would hide it anyway, but a declined send should not
      // leave a row at rest (PRIV-001).
      await tx.notification.deleteMany({
        where: {
          userId: user.id,
          type: "file_sent",
          payload: { path: ["fileSendId"], equals: fileSendId },
        },
      });
    });

    res.status(204).send();
  },
);

export default router;
