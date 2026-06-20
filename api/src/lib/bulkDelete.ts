// Extracted cascade-delete logic for canyons and trips. Shared by
// canyonsBulk POST /delete, tripLogsBulk POST /delete, and the import-undo
// route (DELETE /imports/:batchId). No duplicated cascade logic (CH-001).
//
// Ordering invariant (ARCH-004): S3 blobs are deleted BEFORE database rows so
// an S3 failure leaves rows (and their keys) intact for a retried delete. Row
// deletes and quota decrement share one transaction.

import prisma from "../services/prisma";
import { getEnv } from "../lib/env";
import { deleteS3Keys } from "../lib/s3Cleanup";
import { decrementStorageUsed } from "../lib/storageQuota";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

/**
 * Delete canyons by ID for a given user, cascading through trips, media (S3
 * first), shares, and notifications. Only deletes canyons owned by `userId`.
 * Returns the list of canyon IDs actually deleted.
 */
export async function deleteCanyonsCascade(
  userId: string,
  canyonIds: string[],
): Promise<string[]> {
  if (canyonIds.length === 0) return [];

  const owned = await prisma.canyon.findMany({
    where: { id: { in: canyonIds }, ownerId: userId },
    select: { id: true },
  });
  const ownedIds = owned.map((c) => c.id);
  if (ownedIds.length === 0) return [];

  const tripIds = (
    await prisma.tripLog.findMany({
      where: { canyonId: { in: ownedIds } },
      select: { id: true },
    })
  ).map((t) => t.id);

  const media = await prisma.media.findMany({
    where: {
      OR: [
        { linkedType: "tripLog", linkedId: { in: tripIds } },
        { linkedType: "canyon", linkedId: { in: ownedIds } },
      ],
    },
    select: { s3KeyDisplay: true, s3KeyThumbnail: true, fileSizeBytes: true },
  });

  // S3-first (ARCH-004): blobs before rows.
  const s3Keys = media.flatMap((m) =>
    [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
  );
  const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
  await deleteS3Keys(MEDIA_BUCKET, s3Keys);

  await prisma.$transaction(async (tx) => {
    await tx.media.deleteMany({
      where: { linkedType: "tripLog", linkedId: { in: tripIds } },
    });
    await tx.media.deleteMany({
      where: { linkedType: "canyon", linkedId: { in: ownedIds } },
    });
    await tx.tripLog.deleteMany({ where: { canyonId: { in: ownedIds } } });
    await tx.canyonShare.deleteMany({ where: { canyonId: { in: ownedIds } } });
    // Purge canyon_shared notifications held by OTHER users (the share
    // recipients) that reference the deleted canyons (PRIV-003).
    await tx.notification.deleteMany({
      where: {
        type: "canyon_shared",
        OR: ownedIds.map((canyonId) => ({
          payload: { path: ["canyonId"], equals: canyonId },
        })),
      },
    });
    await tx.canyon.deleteMany({ where: { id: { in: ownedIds } } });
    await decrementStorageUsed(userId, totalBytes, tx);
  });

  return ownedIds;
}

/**
 * Delete trip logs by ID for a given user, cascading through media (S3 first)
 * and quota. Only deletes trips owned by `userId`. Returns the list of trip
 * IDs actually deleted.
 */
export async function deleteTripsCascade(
  userId: string,
  tripIds: string[],
): Promise<string[]> {
  if (tripIds.length === 0) return [];

  const trips = await prisma.tripLog.findMany({
    where: { id: { in: tripIds } },
    select: { id: true, userId: true },
  });
  const ownedIds = trips.filter((t) => t.userId === userId).map((t) => t.id);
  if (ownedIds.length === 0) return [];

  const media = await prisma.media.findMany({
    where: { linkedType: "tripLog", linkedId: { in: ownedIds } },
    select: { s3KeyDisplay: true, s3KeyThumbnail: true, fileSizeBytes: true },
  });

  // S3-first (ARCH-004): blobs before rows.
  const s3Keys = media.flatMap((m) =>
    [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
  );
  const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
  await deleteS3Keys(MEDIA_BUCKET, s3Keys);

  await prisma.$transaction(async (tx) => {
    await tx.media.deleteMany({
      where: { linkedType: "tripLog", linkedId: { in: ownedIds } },
    });
    await tx.tripLog.deleteMany({ where: { id: { in: ownedIds } } });
    await decrementStorageUsed(userId, totalBytes, tx);
  });

  return ownedIds;
}
