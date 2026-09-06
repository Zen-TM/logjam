// Extracted cascade-delete logic for places and trips. Shared by
// placesBulk POST /delete, tripLogsBulk POST /delete, and the import-undo
// route (DELETE /imports/:batchId). No duplicated cascade logic (CH-001).
//
// Ordering invariant (ARCH-004): S3 blobs are deleted BEFORE database rows so
// an S3 failure leaves rows (and their keys) intact for a retried delete. Row
// deletes and quota decrement share one transaction.

import prisma from "../services/prisma";
import { getEnv } from "../lib/env";
import { deleteS3Keys } from "../lib/s3Cleanup";
import { decrementStorageUsed } from "../lib/storageQuota";
import { formatTripPlaceNames, TRIP_NAME_MAX_LENGTH } from "@logjam/shared";
import { partitionPlaceMedia, unlinkStandaloneMedia } from "./mediaLink";
import {
  placeDeleteTombstones,
  placeLinkDeleteTombstones,
  tripDeleteTombstones,
  writeTombstones,
} from "./syncTombstones";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

/** Derived trip titles obey the same length cap as user-supplied ones. */
export function truncateDisplayName(name: string | null): string | null {
  if (name === null) return null;
  return name.length > TRIP_NAME_MAX_LENGTH
    ? name.slice(0, TRIP_NAME_MAX_LENGTH)
    : name;
}

/**
 * Delete places by ID for a given user, cascading through place-level media
 * (S3 first), shares, and notifications. Only deletes places owned by
 * `userId`. Returns the list of place IDs actually deleted.
 *
 * Trip logs are NOT deleted or otherwise touched here: TripLogPlace join
 * rows cascade away at the DB level (ON DELETE CASCADE on
 * TripLogPlace.placeId) when the place row is deleted, but the trip itself
 * survives — it just loses this one linked place (or ends up unlinked, if it
 * had no others). Per-trip media is therefore never deleted by this path and
 * never contributes to the quota decrement below.
 */

export async function deletePlacesCascade(
  userId: string,
  placeIds: string[],
): Promise<string[]> {
  if (placeIds.length === 0) return [];

  const owned = await prisma.place.findMany({
    where: { id: { in: placeIds }, ownerId: userId },
    select: { id: true },
  });
  const ownedIds = owned.map((c) => c.id);
  if (ownedIds.length === 0) return [];

  const placeMediaRows = await prisma.media.findMany({
    where: { linkedType: "place", linkedId: { in: ownedIds } },
    select: {
      id: true,
      linkedId: true,
      origin: true,
      s3KeyDisplay: true,
      s3KeyThumbnail: true,
      fileSizeBytes: true,
    },
  });
  // Standalone files linked as a place's way survive the place (they are the
  // user's own imports and recordings); only its own attachments die with it.
  // Same rule as the single delete — lib/mediaLink.ts owns it.
  const { deleted: media, unlinked: unlinkedMedia } =
    partitionPlaceMedia(placeMediaRows);

  // S3-first (ARCH-004): blobs before rows.
  const s3Keys = media.flatMap((m) =>
    [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
  );
  const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
  await deleteS3Keys(MEDIA_BUCKET, s3Keys);

  await prisma.$transaction(async (tx) => {
    await tx.media.deleteMany({
      where: { id: { in: media.map((m) => m.id) } },
    });
    await unlinkStandaloneMedia(
      tx,
      unlinkedMedia.map((m) => m.id),
    );
    // Preserve the (about-to-be-deleted) places' names on trips for which
    // these were their ONLY linked places, so they still carry a label once
    // the join rows cascade away. Trips that keep another linked place need
    // no backfill (their title still derives from the survivor). Only fill
    // blanks so an explicit trip displayName is never overwritten. Queried
    // before place.deleteMany below, while the join rows still exist.
    const candidateTrips = await tx.tripLog.findMany({
      where: {
        displayName: null,
        places: { some: { placeId: { in: ownedIds } } },
      },
      select: {
        id: true,
        places: {
          orderBy: { position: "asc" },
          select: { placeId: true, place: { select: { name: true } } },
        },
      },
    });
    const orphanedTrips = candidateTrips.filter((trip) =>
      trip.places.every((link) => ownedIds.includes(link.placeId)),
    );
    await Promise.all(
      orphanedTrips.map((trip) =>
        tx.tripLog.update({
          where: { id: trip.id },
          data: {
            // Capped like a user-typed title (parseDisplayName in
            // routes/tripLogsGlobal). An uncapped derived join — 20 places
            // with long names — persists a label PATCH /trips/:id would then
            // reject, stranding the trip at a title the edit dialog cannot
            // save (STP-005).
            displayName: truncateDisplayName(
              formatTripPlaceNames(trip.places.map((link) => link.place.name)),
            ),
          },
        }),
      ),
    );
    // Queried before the deleteMany below, while the share rows still exist:
    // per-place sync-tombstone fan-out — owner forgets place/media/share
    // rows, each sharee forgets the place + its place-level media (same
    // transaction as the delete; see lib/syncTombstones.ts).
    const shares = await tx.placeShare.findMany({
      where: { placeId: { in: ownedIds } },
      select: { id: true, placeId: true, sharedWithId: true },
    });
    // Linked routes SURVIVE (Route.placeId is SetNull) — they become
    // standalone and the owner keeps them; only sharees need a tombstone.
    const linkedRoutes = await tx.route.findMany({
      where: { placeId: { in: ownedIds } },
      select: { id: true, placeId: true },
    });
    // The PLACES at the other end of a link survive — the cascade takes the
    // link row, not the place — but the link rows go, and only a tombstone
    // tells the owner's mirror so. Owner-only: a link grants no visibility.
    const links = await tx.placeLink.findMany({
      where: {
        OR: [{ aPlaceId: { in: ownedIds } }, { bPlaceId: { in: ownedIds } }],
      },
      select: { id: true },
    });
    const tombstones = ownedIds.flatMap((placeId) =>
      placeDeleteTombstones({
        ownerId: userId,
        placeId,
        mediaIds: media
          .filter((m) => m.linkedId === placeId)
          .map((m) => m.id),
        shares: shares.filter((s) => s.placeId === placeId),
        routeId:
          linkedRoutes.find((route) => route.placeId === placeId)?.id ?? null,
        unlinkedMediaIds: unlinkedMedia
          .filter((m) => m.linkedId === placeId)
          .map((m) => m.id),
      }),
    );
    await writeTombstones(tx, [
      ...tombstones,
      ...placeLinkDeleteTombstones({ ownerId: userId, linkIds: links.map((l) => l.id) }),
    ]);
    await tx.placeShare.deleteMany({ where: { placeId: { in: ownedIds } } });
    // Purge place_shared notifications held by OTHER users (the share
    // recipients) that reference the deleted places (PRIV-003).
    await tx.notification.deleteMany({
      where: {
        type: "place_shared",
        OR: ownedIds.map((placeId) => ({
          payload: { path: ["placeId"], equals: placeId },
        })),
      },
    });
    // TripLogPlace rows go via DB ON DELETE CASCADE, which does not fire
    // Prisma's @updatedAt. Only trips that lost their LAST place are touched
    // (the displayName backfill above), so a trip that keeps another place
    // was never re-delivered: every mirror kept rendering the deleted place
    // in the trip's derived title and linking to a place that no longer
    // exists. Touch them before the cascade removes the evidence.
    await tx.tripLog.updateMany({
      where: { places: { some: { placeId: { in: ownedIds } } } },
      data: { updatedAt: new Date() },
    });
    await tx.place.deleteMany({ where: { id: { in: ownedIds } } });
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
