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
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
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
 * Friends-only, the same rule canyon sharing and direct shares enforce. A
 * non-friend in the list fails the whole request rather than being silently
 * dropped — a partial send the user was never told about is worse than an
 * error.
 */
async function parseRecipientIds(
  senderId: string,
  value: unknown,
): Promise<string[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(400, "recipientIds is required");
  }
  if (value.length > MAX_RECIPIENTS_PER_SEND) {
    throw new AppError(
      400,
      `A file can be sent to at most ${MAX_RECIPIENTS_PER_SEND} friends at once`,
    );
  }
  const ids = [...new Set(value)];
  if (!ids.every((id): id is string => typeof id === "string" && id.length > 0)) {
    throw new AppError(400, "recipientIds must be user ids");
  }
  if (ids.includes(senderId)) {
    throw new AppError(400, "You cannot send a file to yourself");
  }

  const friendships = await prisma.friendship.findMany({
    where: {
      status: "accepted",
      OR: [
        { requesterId: senderId, addresseeId: { in: ids } },
        { requesterId: { in: ids }, addresseeId: senderId },
      ],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = new Set(
    friendships.map((row) =>
      row.requesterId === senderId ? row.addresseeId : row.requesterId,
    ),
  );
  if (ids.some((id) => !friendIds.has(id))) {
    throw new AppError(403, "You can only send files to friends");
  }
  return ids;
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
        throw new AppError(404, "File send not found");
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
        // routinely names a canyon (PRIV-005). The sender's username is
        // resolved from the live row at read time in notifications.ts.
        await tx.notification.createMany({
          data: recipientIds
            .filter((id) => notifiable.has(id))
            .map((id) => ({
              userId: id,
              type: "file_sent",
              payload: { fileSendId, sentById: user.id },
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

    for (const id of recipientIds) {
      if (notifiable.has(id)) {
        // Best-effort push after commit; generic title + opaque id only.
        void sendPushToUser(id, { type: "file_sent", fileSendId });
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
 * The recipient inbox filter: my non-declined rows on sends that have not
 * expired. Expiry is repeated here rather than left to the sweep because the
 * sweep is periodic — a row can outlive its usefulness by up to one interval.
 */
export function inboxWhere(userId: string, now: Date) {
  return {
    userId,
    status: { not: "declined" },
    fileSend: { expiresAt: { gt: now } },
  };
}

/**
 * The recipient's own row for a send, or 404.
 *
 * A user who is not a recipient gets exactly what a non-existent id gets, so
 * the status cannot confirm that a send exists to someone it was not sent to.
 */
async function loadRecipientRow(userId: string, fileSendId: string) {
  const row = await prisma.fileSendRecipient.findFirst({
    where: recipientRowWhere(userId, fileSendId),
    include: { fileSend: true },
  });
  if (!row) throw new AppError(404, "File send not found");
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
      throw new AppError(404, "File send not found");
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
