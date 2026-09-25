// Bringing a shared place's PHOTOS AND FILES along when it is copied.
//
// Place-level media is what a sharee can already see (the hybrid share model:
// place-level `notes` and place-level `media` reach the recipient, per-trip
// media never does), so copying it grants nothing new — it just stops the copy
// being a strictly worse version of what the user was already looking at.
//
// WHY IT IS OPTIONAL, and why the default is ON. Unlike the place row and its
// route, media costs bytes: new S3 objects charged to the COPIER's 5 GiB
// storage quota. So the user gets a say, remembered in
// `uiPreferences.copyPlaceMedia`. The default is on because the two failure
// directions are not symmetric — not copying is SILENT (the photos are simply
// missing, and after a copy-and-remove the phone has dropped the cached blobs
// too), while copying too eagerly fails LOUDLY at the quota with a 507 the user
// can read and act on.
//
// THIS NEVER THROWS FOR QUOTA. The route preflights the quota before it creates
// anything (`assertHasStorageQuota`), so the ordinary over-quota case is a 507
// with no place created. What is left here is the RACE — a concurrent upload
// eating the headroom between the preflight and the charge — and by then the
// place exists and the user can see it. Failing the whole request at that point
// would report "copy failed" for a copy that happened. So the media is dropped,
// the objects are cleaned up, and the result says so for the client to report.
//
// PRIVACY: filenames and display names are user text that routinely name
// places. Nothing here logs them.
import { randomUUID } from "crypto";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import type { Prisma } from "@prisma/client";

import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { getEnv } from "./env";
import { logger, safeErrorForLog } from "./logger";
import { mediaKeys } from "./mediaKeys";
import { deleteS3KeysBestEffort } from "./s3Cleanup";
import { getStorageUsage, incrementStorageUsed } from "./storageQuota";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

export type PlaceMediaCopyResult = {
  /** Media rows the copy now owns. */
  copied: number;
  /**
   * Media the copy did NOT get, for whatever reason. The caller states this to
   * the user — a count that goes unmentioned is the silent loss this whole
   * option exists to avoid.
   */
  skipped: number;
  /**
   * Set when the copier ran out of storage between the preflight and the
   * charge. The client says "your storage filled up" rather than the generic
   * couldn't-copy-that.
   */
  outOfSpace?: true;
};

/** Place-level media on a place, and what copying it would cost in bytes. */
export async function placeMediaToCopy(placeId: string) {
  const rows = await prisma.media.findMany({
    where: { linkedType: "place", linkedId: placeId },
    orderBy: { createdAt: "asc" },
  });
  // `fileSizeBytes` is display + thumbnail, as charged at confirm — so summing
  // it is exactly what the copy will add, with no second size convention.
  const totalBytes = rows.reduce((sum, row) => sum + row.fileSizeBytes, 0n);
  return { rows, totalBytes };
}

/**
 * Copy every place-level media item of `sourcePlaceId` onto `targetPlaceId`,
 * owned by `recipientId`.
 *
 * Objects first, rows second, and only the objects that actually landed are
 * charged or recorded: a row pointing at a key that failed to copy is a
 * thumbnail that 404s forever, which is worse than a missing photo.
 */
export async function copyPlaceMedia(args: {
  sourcePlaceId: string;
  targetPlaceId: string;
  recipientId: string;
}): Promise<PlaceMediaCopyResult> {
  const { rows } = await placeMediaToCopy(args.sourcePlaceId);
  if (rows.length === 0) return { copied: 0, skipped: 0 };

  const landed: Prisma.MediaCreateManyInput[] = [];
  const landedKeys: string[] = [];
  let landedBytes = 0n;

  for (const row of rows) {
    const mediaId = randomUUID();
    const target = mediaKeys(args.recipientId, mediaId, row.mediaType);
    const pairs: [from: string, to: string][] = [
      [row.s3KeyDisplay, target.displayKey],
      ...(row.s3KeyThumbnail
        ? ([[row.s3KeyThumbnail, target.thumbnailKey]] as [string, string][])
        : []),
    ];
    try {
      for (const [from, to] of pairs) {
        await s3.send(
          new CopyObjectCommand({
            Bucket: MEDIA_BUCKET,
            // Same bucket, so this is a server-side copy: no download, no
            // egress charged to anyone, and the sharee's own egress allowance
            // is untouched.
            CopySource: `${MEDIA_BUCKET}/${encodeURIComponent(from).replace(/%2F/g, "/")}`,
            Key: to,
          }),
        );
      }
    } catch (err) {
      // Ids and counts only — never the filename.
      logger.warn(
        { mediaId, err: safeErrorForLog(err) },
        "place_copy_media_object_failed",
      );
      await deleteS3KeysBestEffort(
        MEDIA_BUCKET,
        pairs.map(([, to]) => to),
      );
      continue;
    }
    landedKeys.push(...pairs.map(([, to]) => to));
    landedBytes += row.fileSizeBytes;
    landed.push({
      id: mediaId,
      ownerId: args.recipientId,
      linkedType: "place",
      linkedId: args.targetPlaceId,
      s3KeyDisplay: target.displayKey,
      s3KeyThumbnail: row.s3KeyThumbnail ? target.thumbnailKey : null,
      mediaType: row.mediaType,
      filename: row.filename,
      fileSizeBytes: row.fileSizeBytes,
      // A place attachment carries no origin and no displayName (those belong
      // to standalone files), and a track keeps its colour so the copied place
      // draws its line the way the original did.
      color: row.color,
      metadata: row.metadata as Prisma.InputJsonValue,
    });
  }

  if (landed.length === 0) return { copied: 0, skipped: rows.length };

  try {
    // The charge and the rows commit together, and the authoritative
    // over-quota check runs inside — the same shape POST /media/:id/confirm
    // uses, for the same reason: no crash window may leave the quota charged
    // with nothing to show for it.
    await prisma.$transaction(async (tx) => {
      await incrementStorageUsed(args.recipientId, landedBytes, tx);
      const { used, quota } = await getStorageUsage(args.recipientId, tx);
      if (used > quota) throw new OutOfSpace();
      await tx.media.createMany({ data: landed });
    });
  } catch (err) {
    await deleteS3KeysBestEffort(MEDIA_BUCKET, landedKeys);
    if (err instanceof OutOfSpace) {
      return { copied: 0, skipped: rows.length, outOfSpace: true };
    }
    throw err;
  }

  return { copied: landed.length, skipped: rows.length - landed.length };
}

/** Internal rollback signal — never reaches a response. */
class OutOfSpace extends Error {}
