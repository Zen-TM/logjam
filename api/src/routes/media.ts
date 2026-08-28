import { Router, Response } from "express";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../services/awsClients";
import { getEnv } from "../lib/env";
import { getParam } from "../lib/getParam";
import { resolveUser as getUser } from "../lib/resolveUser";
import {
  assertHasStorageQuota,
  incrementStorageUsed,
  decrementStorageUsed,
  getStorageUsage,
} from "../lib/storageQuota";
import { deleteS3Keys, deleteS3KeysBestEffort } from "../lib/s3Cleanup";
import { validateUploadSizes } from "../lib/mediaUploadValidation";
import { toMediaItem } from "../lib/mediaPresign";
import { requireCanyonOwnerAccess } from "../lib/canyonAccess";
import { mediaDeleteTombstones, writeTombstones } from "../lib/syncTombstones";
import {
  assertClientIdReplayable,
  parseClientSuppliedId,
} from "../lib/clientSuppliedId";
import {
  mediaCategory,
  categoryHasThumbnail,
  pickNextTrackColor,
  MEDIA_SIZE_CAPS,
  MEDIA_EXTENSION_BY_MIME,
  TRACK_MIME_TYPES,
  type MediaCategory,
} from "@logjam/shared";

const router = Router();

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";
const UPLOAD_URL_TTL_SECONDS = 900; // 15 minutes
const THUMBNAIL_MIME = "image/jpeg";

// Only the owner of the target canyon (or the canyon owning the trip log) may
// attach media — even on canyons shared with them.
async function assertOwnsTarget(
  userId: string,
  linkedType: string,
  linkedId: string,
) {
  if (linkedType === "canyon") {
    const canyon = await prisma.canyon.findUnique({
      where: { id: linkedId },
      select: { id: true, ownerId: true },
    });
    if (!canyon) throw new AppError(404, "Canyon not found");
    // none → 404 (no existence oracle for canyons the caller can't see);
    // sharee → 403 (legitimately sees the canyon, just can't attach media).
    await requireCanyonOwnerAccess(
      userId,
      canyon,
      "Only the owner can attach media",
    );
  } else if (linkedType === "tripLog") {
    const trip = await prisma.tripLog.findUnique({
      where: { id: linkedId },
      select: { userId: true },
    });
    // Trip logs are owner-private (no sharing): a non-owner gets the same 404 as
    // a missing trip so the status is not an existence oracle for trip-log IDs.
    if (!trip || trip.userId !== userId)
      throw new AppError(404, "Trip log not found");
  } else {
    throw new AppError(400, "Invalid linkedType");
  }
}

// A canyon may have at most one track (GPX/KML). Trip logs are unconstrained.
// Checked in both presign (fail fast) and confirm (authoritative — the presign
// check can race; the orphan sweeper reclaims a blob whose confirm is rejected).
async function assertCanyonTrackSlotFree(
  linkedType: string,
  linkedId: string,
  category: MediaCategory,
) {
  if (linkedType !== "canyon" || category !== "track") return;
  const existing = await prisma.media.count({
    where: {
      linkedType: "canyon",
      linkedId,
      mediaType: { in: TRACK_MIME_TYPES as unknown as string[] },
    },
  });
  if (existing > 0) throw new AppError(409, "This canyon already has a track");
}

function validateMediaType(mediaType: unknown, filename: unknown): MediaCategory {
  if (
    typeof mediaType !== "string" ||
    typeof filename !== "string" ||
    !filename.trim()
  ) {
    throw new AppError(400, "filename and mediaType are required");
  }
  const category = mediaCategory(mediaType);
  if (!category) throw new AppError(400, `Unsupported media type: ${mediaType}`);
  // Browsers report inconsistent MIME types for GPX/KML, so require a matching
  // extension to pin down the format.
  if (category === "track") {
    const ext = filename.split(".").pop()?.toLowerCase();
    const expected = MEDIA_EXTENSION_BY_MIME[mediaType];
    if (ext !== expected)
      throw new AppError(400, `Track file must have a .${expected} extension`);
  }
  return category;
}

// Keys are derived entirely from server-side values (ownerId + mediaId + MIME),
// so the client can never point a confirm at someone else's object.
function mediaKeys(ownerId: string, mediaId: string, mediaType: string) {
  const ext = MEDIA_EXTENSION_BY_MIME[mediaType];
  return {
    displayKey: `media/${ownerId}/${mediaId}/display.${ext}`,
    thumbnailKey: `media/${ownerId}/${mediaId}/thumb.jpg`,
  };
}

// POST /media/presign — validate ownership + type, return presigned PUT URL(s).
// No DB row is created until the upload is confirmed.
router.post(
  "/presign",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const { linkedType, linkedId, filename, mediaType, sizeBytes, thumbnailSizeBytes } =
      req.body ?? {};
    if (typeof linkedId !== "string")
      throw new AppError(400, "linkedId is required");
    const category = validateMediaType(mediaType, filename);
    // Declared sizes bound the presigned PUTs (SEC-003): they are signed into
    // Content-Length below, so S3 rejects uploads that exceed the declaration.
    const sizes = validateUploadSizes(category, sizeBytes, thumbnailSizeBytes);
    await assertOwnsTarget(user.id, linkedType, linkedId);
    await assertCanyonTrackSlotFree(linkedType, linkedId, category);
    // Headroom pre-check including the declared upload; the authoritative
    // quota charge still happens on confirm against the real S3 size.
    await assertHasStorageQuota(
      user.id,
      BigInt(sizes.sizeBytes + (sizes.thumbnailSizeBytes ?? 0)),
    );

    // Optional client-minted mediaId (Stage 8 §3.5). A client id whose row
    // already exists means the whole three-phase flow already completed —
    // return the existing item (200), never fresh upload URLs. Foreign id →
    // 404 (anti-oracle; see lib/clientSuppliedId.ts).
    const clientMediaId = parseClientSuppliedId(
      (req.body ?? {}).mediaId,
      "mediaId",
    );
    if (clientMediaId) {
      const existing = await prisma.media.findUnique({
        where: { id: clientMediaId },
      });
      if (existing) {
        assertClientIdReplayable(existing.ownerId, user.id, "Media not found");
        res.status(200).json(await toMediaItem(existing));
        return;
      }
    }

    const mediaId = clientMediaId ?? randomUUID();
    const { displayKey, thumbnailKey } = mediaKeys(user.id, mediaId, mediaType);

    const displayUploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: displayKey,
        ContentType: mediaType,
        ContentLength: sizes.sizeBytes,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    let thumbnailUploadUrl: string | null = null;
    if (categoryHasThumbnail(category)) {
      thumbnailUploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: MEDIA_BUCKET,
          Key: thumbnailKey,
          ContentType: THUMBNAIL_MIME,
          ContentLength: sizes.thumbnailSizeBytes!,
        }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS },
      );
    }

    res.status(201).json({ mediaId, displayUploadUrl, thumbnailUploadUrl });
  },
);

// POST /media/:mediaId/confirm — verify the upload landed in S3, charge the
// authoritative size against the user's quota, then create the DB row.
router.post(
  "/:mediaId/confirm",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const mediaId = getParam(req.params.mediaId);
    const { linkedType, linkedId, filename, mediaType } = req.body ?? {};
    if (typeof linkedId !== "string")
      throw new AppError(400, "linkedId is required");
    const category = validateMediaType(mediaType, filename);
    await assertOwnsTarget(user.id, linkedType, linkedId);

    // Idempotent confirm (ARCH-005): if the row already exists, this confirm
    // already succeeded — return it (handled below) before the track-slot guard
    // so a retried confirm of the same row is a no-op, not a spurious 409,
    // and without re-charging quota (client retries / double-clicks are benign).
    // A foreign-owned row is 404, not 403: with client-minted presign ids
    // (Stage 8 §3.5) a probed foreign mediaId is reachable here, and 403 would
    // confirm it exists (SEC-001 anti-oracle).
    const existing = await prisma.media.findUnique({ where: { id: mediaId } });
    if (existing) {
      if (existing.ownerId !== user.id)
        throw new AppError(404, "Media not found");
      res.status(200).json(await toMediaItem(existing));
      return;
    }

    await assertCanyonTrackSlotFree(linkedType, linkedId, category);

    const { displayKey, thumbnailKey } = mediaKeys(user.id, mediaId, mediaType);
    const expectThumb = categoryHasThumbnail(category);

    // Authoritative size from S3 — never trust the client's declared size.
    let displayBytes: number;
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: displayKey }),
      );
      displayBytes = head.ContentLength ?? 0;
    } catch {
      throw new AppError(400, "File has not been uploaded yet");
    }
    if (displayBytes > MEDIA_SIZE_CAPS[category]) {
      // Best-effort orphan cleanup; the size-limit AppError below is the
      // meaningful response, so a cleanup failure (already logged) must not
      // mask it with a generic 500.
      await deleteS3KeysBestEffort(MEDIA_BUCKET, [displayKey, thumbnailKey]);
      const limitMb = Math.round(MEDIA_SIZE_CAPS[category] / 1024 / 1024);
      throw new AppError(413, `File exceeds the ${limitMb} MB limit for ${category}s`);
    }

    let thumbnailBytes = 0;
    if (expectThumb) {
      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: thumbnailKey }),
        );
        thumbnailBytes = head.ContentLength ?? 0;
      } catch {
        await deleteS3KeysBestEffort(MEDIA_BUCKET, [displayKey]);
        throw new AppError(400, "Thumbnail has not been uploaded yet");
      }
    }

    const totalBytes = BigInt(displayBytes + thumbnailBytes);

    // One interactive transaction (ARCH-005 / Design Q): the quota charge,
    // the over-quota check and the row creation commit — or roll back —
    // together. No crash window can leave the quota charged without a row,
    // and an over-quota throw undoes the charge without a manual decrement.
    let media;
    try {
      media = await prisma.$transaction(async (tx) => {
        await incrementStorageUsed(user.id, totalBytes, tx);
        const { used, quota } = await getStorageUsage(user.id, tx);
        if (used > quota) {
          throw new AppError(507, "Storage quota exceeded", {
            used: used.toString(),
            quota: quota.toString(),
          });
        }

        let assignedColor: string | null = null;
        if (category === "track") {
          const existingTracks = await tx.media.findMany({
            where: {
              OR: [
                { ownerId: user.id },
                ...(linkedId ? [{ linkedId }] : []),
              ],
              color: { not: null },
            },
            select: { color: true },
          });
          assignedColor = pickNextTrackColor(existingTracks.map((t) => t.color));
        }

        return tx.media.create({
          data: {
            id: mediaId,
            ownerId: user.id,
            linkedType,
            linkedId,
            s3KeyDisplay: displayKey,
            s3KeyThumbnail: expectThumb ? thumbnailKey : null,
            mediaType,
            filename,
            fileSizeBytes: totalBytes,
            // Tracks get a deterministic next colour avoiding collisions;
            // image/video media carry none.
            color: assignedColor,
          },
        });
      });
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 507) {
        // Transaction rolled back (charge undone); remove the uploaded
        // objects best-effort so the 507 is not masked by a cleanup failure.
        await deleteS3KeysBestEffort(
          MEDIA_BUCKET,
          expectThumb ? [displayKey, thumbnailKey] : [displayKey],
        );
        throw err;
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // A concurrent duplicate confirm won the race: this transaction
        // rolled back (nothing double-charged) — return the winner's row.
        const winner = await prisma.media.findUnique({ where: { id: mediaId } });
        if (winner && winner.ownerId === user.id) {
          res.status(200).json(await toMediaItem(winner));
          return;
        }
      }
      throw err;
    }

    res.status(201).json(await toMediaItem(media));
  },
);

// POST /media/download-urls — batch presigned GET URLs for the mobile blob
// cache (Stage 8 §7.3; delta media rows carry metadata only). Authorization
// per id: owner, or sharee of the canyon a canyon-linked row is attached to.
// Rows the caller can't see are OMITTED, never erred — the response must not
// confirm foreign ids (anti-oracle; deliberately supersedes the attach-403
// pattern rather than copying it).
const DOWNLOAD_URLS_MAX_IDS = 100;

router.post(
  "/download-urls",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.some((id) => typeof id !== "string")
    ) {
      throw new AppError(400, "ids array is required");
    }
    if (ids.length > DOWNLOAD_URLS_MAX_IDS) {
      throw new AppError(
        413,
        `At most ${DOWNLOAD_URLS_MAX_IDS} ids per request`,
      );
    }

    const rows = await prisma.media.findMany({
      where: { id: { in: ids as string[] } },
    });
    // Visibility set derived from the caller's own shares — one query, no
    // per-id role lookups.
    const candidateCanyonIds = Array.from(
      new Set(
        rows
          .filter((m) => m.ownerId !== user.id && m.linkedType === "canyon")
          .map((m) => m.linkedId),
      ),
    );
    const sharedCanyonIds = new Set(
      candidateCanyonIds.length > 0
        ? (
            await prisma.canyonShare.findMany({
              where: {
                sharedWithId: user.id,
                canyonId: { in: candidateCanyonIds },
              },
              select: { canyonId: true },
            })
          ).map((s) => s.canyonId)
        : [],
    );
    const visible = rows.filter(
      (m) =>
        m.ownerId === user.id ||
        (m.linkedType === "canyon" && sharedCanyonIds.has(m.linkedId)),
    );

    const items = await Promise.all(
      visible.map(async (row) => {
        const item = await toMediaItem(row);
        return {
          id: item.id,
          displayUrl: item.displayUrl,
          thumbnailUrl: item.thumbnailUrl,
        };
      }),
    );
    res.json({ items });
  },
);

// DELETE /media/:id — remove a single media item (owner only). Bulk/cascade
// deletes on canyon/trip/account live in their respective routes.
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const id = getParam(req.params.id);
    // Owner-scoped: a foreign media id gets the SAME 404 a non-existent one
    // gets. A sharee sees canyon-level media ids in a shared canyon payload,
    // so a 403 here would confirm which of them are real (APIR-013/PRIV-106) —
    // the presign path in this same file already argues exactly that.
    const media = await prisma.media.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!media) throw new AppError(404, "Media not found");

    // S3-first (ARCH-004): blobs go before the row, so an S3 failure leaves
    // the row (and therefore the keys) intact for a retried DELETE. The row
    // delete and the quota decrement then share one transaction so a crash
    // between them can't leave the quota over-counted.
    await deleteS3Keys(
      MEDIA_BUCKET,
      [media.s3KeyDisplay, media.s3KeyThumbnail].filter((k): k is string =>
        Boolean(k),
      ),
    );
    await prisma.$transaction(async (tx) => {
      // Canyon-level media is visible to the canyon's sharees (hybrid model),
      // so they must be told to forget it too. Trip media is owner-private —
      // no fan-out (sync tombstone rule, same transaction as the delete).
      const sharees =
        media.linkedType === "canyon"
          ? await tx.canyonShare.findMany({
              where: { canyonId: media.linkedId },
              select: { sharedWithId: true },
            })
          : [];
      await tx.media.delete({ where: { id } });
      await decrementStorageUsed(user.id, media.fileSizeBytes, tx);
      await writeTombstones(
        tx,
        mediaDeleteTombstones({
          ownerId: user.id,
          mediaId: id,
          shareeIds: sharees.map((s) => s.sharedWithId),
        }),
      );
    });

    res.status(204).send();
  },
);

export default router;
