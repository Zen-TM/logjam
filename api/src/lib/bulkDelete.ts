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
import { formatTripCanyonNames, TRIP_NAME_MAX_LENGTH } from "@logjam/shared";
import {
  canyonDeleteTombstones,
  tripDeleteTombstones,
  writeTombstones,
} from "./syncTombstones";
import {
  snapshotWaypointVisibility,
  writeWaypointVisibilityLoss,
} from "./waypointLink";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

/** Derived trip titles obey the same length cap as user-supplied ones. */
export function truncateDisplayName(name: string | null): string | null {
  if (name === null) return null;
  return name.length > TRIP_NAME_MAX_LENGTH
    ? name.slice(0, TRIP_NAME_MAX_LENGTH)
    : name;
}

/**
 * Delete canyons by ID for a given user, cascading through canyon-level media
 * (S3 first), shares, and notifications. Only deletes canyons owned by
 * `userId`. Returns the list of canyon IDs actually deleted.
 *
 * Trip logs are NOT deleted or otherwise touched here: TripLogCanyon join
 * rows cascade away at the DB level (ON DELETE CASCADE on
 * TripLogCanyon.canyonId) when the canyon row is deleted, but the trip itself
 * survives — it just loses this one linked canyon (or ends up unlinked, if it
 * had no others). Per-trip media is therefore never deleted by this path and
 * never contributes to the quota decrement below.
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

  const media = await prisma.media.findMany({
    where: { linkedType: "canyon", linkedId: { in: ownedIds } },
    select: {
      id: true,
      linkedId: true,
      s3KeyDisplay: true,
      s3KeyThumbnail: true,
      fileSizeBytes: true,
    },
  });

  // S3-first (ARCH-004): blobs before rows.
  const s3Keys = media.flatMap((m) =>
    [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
  );
  const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
  await deleteS3Keys(MEDIA_BUCKET, s3Keys);

  await prisma.$transaction(async (tx) => {
    await tx.media.deleteMany({
      where: { linkedType: "canyon", linkedId: { in: ownedIds } },
    });
    // Preserve the (about-to-be-deleted) canyons' names on trips for which
    // these were their ONLY linked canyons, so they still carry a label once
    // the join rows cascade away. Trips that keep another linked canyon need
    // no backfill (their title still derives from the survivor). Only fill
    // blanks so an explicit trip displayName is never overwritten. Queried
    // before canyon.deleteMany below, while the join rows still exist.
    const candidateTrips = await tx.tripLog.findMany({
      where: {
        displayName: null,
        canyons: { some: { canyonId: { in: ownedIds } } },
      },
      select: {
        id: true,
        canyons: {
          orderBy: { position: "asc" },
          select: { canyonId: true, canyon: { select: { name: true } } },
        },
      },
    });
    const orphanedTrips = candidateTrips.filter((trip) =>
      trip.canyons.every((link) => ownedIds.includes(link.canyonId)),
    );
    await Promise.all(
      orphanedTrips.map((trip) =>
        tx.tripLog.update({
          where: { id: trip.id },
          data: {
            // Capped like a user-typed title (parseDisplayName in
            // routes/tripLogsGlobal). An uncapped derived join — 20 canyons
            // with long names — persists a label PATCH /trips/:id would then
            // reject, stranding the trip at a title the edit dialog cannot
            // save (STP-005).
            displayName: truncateDisplayName(
              formatTripCanyonNames(trip.canyons.map((link) => link.canyon.name)),
            ),
          },
        }),
      ),
    );
    // Queried before the deleteMany below, while the share rows still exist:
    // per-canyon sync-tombstone fan-out — owner forgets canyon/media/share
    // rows, each sharee forgets the canyon + its canyon-level media (same
    // transaction as the delete; see lib/syncTombstones.ts).
    const shares = await tx.canyonShare.findMany({
      where: { canyonId: { in: ownedIds } },
      select: { id: true, canyonId: true, sharedWithId: true },
    });
    // Linked routes SURVIVE (Route.canyonId is SetNull) — they become
    // standalone and the owner keeps them; only sharees need a tombstone.
    const linkedRoutes = await tx.route.findMany({
      where: { canyonId: { in: ownedIds } },
      select: { id: true, canyonId: true },
    });
    // Linked waypoints survive the same way, but their m2m links mean the loss
    // has to be measured across the delete rather than assumed.
    const waypointVisibility = await snapshotWaypointVisibility(
      tx,
      (
        await tx.canyonWaypoint.findMany({
          where: { canyonId: { in: ownedIds } },
          select: { waypointId: true },
        })
      ).map((link) => link.waypointId),
    );
    const tombstones = ownedIds.flatMap((canyonId) =>
      canyonDeleteTombstones({
        ownerId: userId,
        canyonId,
        mediaIds: media
          .filter((m) => m.linkedId === canyonId)
          .map((m) => m.id),
        shares: shares.filter((s) => s.canyonId === canyonId),
        routeId:
          linkedRoutes.find((route) => route.canyonId === canyonId)?.id ?? null,
      }),
    );
    await writeTombstones(tx, tombstones);
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
    // TripLogCanyon rows go via DB ON DELETE CASCADE, which does not fire
    // Prisma's @updatedAt. Only trips that lost their LAST canyon are touched
    // (the displayName backfill above), so a trip that keeps another canyon
    // was never re-delivered: every mirror kept rendering the deleted canyon
    // in the trip's derived title and linking to a canyon that no longer
    // exists. Touch them before the cascade removes the evidence.
    await tx.tripLog.updateMany({
      where: { canyons: { some: { canyonId: { in: ownedIds } } } },
      data: { updatedAt: new Date() },
    });
    await tx.canyon.deleteMany({ where: { id: { in: ownedIds } } });
    await writeWaypointVisibilityLoss(tx, waypointVisibility);
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
    select: {
      id: true,
      linkedId: true,
      s3KeyDisplay: true,
      s3KeyThumbnail: true,
      fileSizeBytes: true,
    },
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
    // Same transaction as the delete (sync tombstone rule).
    await writeTombstones(
      tx,
      ownedIds.flatMap((tripId) =>
        tripDeleteTombstones({
          ownerId: userId,
          tripId,
          mediaIds: media
            .filter((m) => m.linkedId === tripId)
            .map((m) => m.id),
        }),
      ),
    );
  });

  return ownedIds;
}
