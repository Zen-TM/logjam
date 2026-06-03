import { Router, Response } from "express";
import { randomUUID } from "crypto";
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
import { toMediaItem } from "../lib/mediaPresign";
import {
  mediaCategory,
  categoryHasThumbnail,
  MEDIA_SIZE_CAPS,
  MEDIA_EXTENSION_BY_MIME,
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
      select: { ownerId: true },
    });
    if (!canyon) throw new AppError(404, "Canyon not found");
    if (canyon.ownerId !== userId)
      throw new AppError(403, "Only the owner can attach media");
  } else if (linkedType === "tripLog") {
    const trip = await prisma.tripLog.findUnique({
      where: { id: linkedId },
      select: { canyon: { select: { ownerId: true } } },
    });
    if (!trip) throw new AppError(404, "Trip log not found");
    if (trip.canyon.ownerId !== userId)
      throw new AppError(403, "Only the owner can attach media");
  } else {
    throw new AppError(400, "Invalid linkedType");
  }
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
    const { linkedType, linkedId, filename, mediaType } = req.body ?? {};
    if (typeof linkedId !== "string")
      throw new AppError(400, "linkedId is required");
    const category = validateMediaType(mediaType, filename);
    await assertOwnsTarget(user.id, linkedType, linkedId);
    // Soft pre-check; the authoritative quota check happens on confirm.
    await assertHasStorageQuota(user.id);

    const mediaId = randomUUID();
    const { displayKey, thumbnailKey } = mediaKeys(user.id, mediaId, mediaType);

    const displayUploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: displayKey,
        ContentType: mediaType,
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

    // Charge first, then verify we didn't blow the quota — roll back if we did.
    await incrementStorageUsed(user.id, totalBytes);
    const { used, quota } = await getStorageUsage(user.id);
    if (used > quota) {
      await decrementStorageUsed(user.id, totalBytes);
      await deleteS3KeysBestEffort(
        MEDIA_BUCKET,
        expectThumb ? [displayKey, thumbnailKey] : [displayKey],
      );
      throw new AppError(507, "Storage quota exceeded", {
        used: used.toString(),
        quota: quota.toString(),
      });
    }

    const media = await prisma.media.create({
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
      },
    });

    res.status(201).json(await toMediaItem(media));
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
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new AppError(404, "Media not found");
    if (media.ownerId !== user.id) throw new AppError(403, "Access denied");

    await prisma.media.delete({ where: { id } });
    await deleteS3Keys(
      MEDIA_BUCKET,
      [media.s3KeyDisplay, media.s3KeyThumbnail].filter((k): k is string =>
        Boolean(k),
      ),
    );
    await decrementStorageUsed(user.id, media.fileSizeBytes);

    res.status(204).send();
  },
);

export default router;
