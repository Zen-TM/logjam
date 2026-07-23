// Stage 8 delta-sync tombstones: per-user deletion/visibility-revocation log.
// A row means "user X must remove entity (type,id) from any local mirror".
//
// Convention (sync-era sibling of the ARCH-001 S3-purge rule): any hard-delete
// of a synced entity must call writeTombstones IN THE SAME TRANSACTION as the
// delete it records, fanning out to every user whose visibility included the
// row. Never after the transaction — a crash between delete and tombstone
// would orphan mirrors forever.
//
// The builders below are pure (unit-testable, Prisma-free): they turn the
// facts a delete site already has (owner, sharees, media ids) into the exact
// tombstone rows the spec's §3.3 site table requires. Rows carry ids only —
// never names/coords — so the table is log-safe (privacy rules).

import { Prisma } from "@prisma/client";
import type { SyncEntityType } from "@logjam/shared";

export type TombstoneRow = {
  userId: string;
  entityType: SyncEntityType;
  entityId: string;
};

/** Insert tombstone rows inside the caller's transaction. No-op on []. */
export async function writeTombstones(
  tx: Prisma.TransactionClient,
  rows: TombstoneRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.syncTombstone.createMany({ data: rows });
}

/** DELETE /trips/:id (and each row of the bulk cascade): owner forgets the
 * trip and its media. Trips are owner-private, so there is no fan-out. */
export function tripDeleteTombstones(args: {
  ownerId: string;
  tripId: string;
  mediaIds: string[];
}): TombstoneRow[] {
  const { ownerId, tripId, mediaIds } = args;
  return [
    { userId: ownerId, entityType: "tripLog", entityId: tripId },
    ...mediaIds.map(
      (id): TombstoneRow => ({ userId: ownerId, entityType: "media", entityId: id }),
    ),
  ];
}

/** DELETE /canyons/:id (and each row of the bulk cascade): the owner forgets
 * the canyon, its media and every revoked share row; each sharee forgets the
 * canyon and its canyon-level media. A sharee's signal here is deliberately
 * identical to an unshare (canyon tombstone) — continued-existence oracle
 * closed (§4.6.3). */
export function canyonDeleteTombstones(args: {
  ownerId: string;
  canyonId: string;
  mediaIds: string[];
  shares: { id: string; sharedWithId: string }[];
}): TombstoneRow[] {
  const { ownerId, canyonId, mediaIds, shares } = args;
  const rows: TombstoneRow[] = [
    { userId: ownerId, entityType: "canyon", entityId: canyonId },
    ...mediaIds.map(
      (id): TombstoneRow => ({ userId: ownerId, entityType: "media", entityId: id }),
    ),
    ...shares.map(
      (share): TombstoneRow => ({
        userId: ownerId,
        entityType: "canyonShare",
        entityId: share.id,
      }),
    ),
  ];
  for (const share of shares) {
    rows.push({ userId: share.sharedWithId, entityType: "canyon", entityId: canyonId });
    for (const id of mediaIds) {
      rows.push({ userId: share.sharedWithId, entityType: "media", entityId: id });
    }
  }
  return rows;
}

/** DELETE /media/:id: the owner forgets it; if it was canyon-level media of a
 * shared canyon, every current sharee forgets it too. */
export function mediaDeleteTombstones(args: {
  ownerId: string;
  mediaId: string;
  shareeIds: string[];
}): TombstoneRow[] {
  const { ownerId, mediaId, shareeIds } = args;
  return [
    { userId: ownerId, entityType: "media", entityId: mediaId },
    ...shareeIds.map(
      (userId): TombstoneRow => ({ userId, entityType: "media", entityId: mediaId }),
    ),
  ];
}

/** Share revocation (DELETE /canyons/:id/share/:userId, unshare-all, and the
 * per-share leg of unfriend): the sharee loses the whole canyon record — the
 * same `canyon` tombstone a canyon-delete would emit (§4.6.3) — plus its
 * canyon-level media; the canyon owner forgets the share row. */
export function shareRevokeTombstones(args: {
  canyonOwnerId: string;
  shareeId: string;
  shareId: string;
  canyonId: string;
  canyonMediaIds: string[];
}): TombstoneRow[] {
  const { canyonOwnerId, shareeId, shareId, canyonId, canyonMediaIds } = args;
  return [
    { userId: shareeId, entityType: "canyon", entityId: canyonId },
    ...canyonMediaIds.map(
      (id): TombstoneRow => ({ userId: shareeId, entityType: "media", entityId: id }),
    ),
    { userId: canyonOwnerId, entityType: "canyonShare", entityId: shareId },
  ];
}

/** Friendship row removal (decline, unfriend, account delete): both parties
 * must forget the edge. Callers filter out a party that is itself being
 * deleted (its tombstones would be pointless — the cascade wipes them). */
export function friendshipDeleteTombstones(args: {
  friendshipId: string;
  userIds: string[];
}): TombstoneRow[] {
  const { friendshipId, userIds } = args;
  return userIds.map(
    (userId): TombstoneRow => ({
      userId,
      entityType: "friendship",
      entityId: friendshipId,
    }),
  );
}

/** DELETE /waypoints/:id: owner-private, no fan-out. */
export function waypointDeleteTombstones(args: {
  ownerId: string;
  waypointId: string;
}): TombstoneRow[] {
  return [
    {
      userId: args.ownerId,
      entityType: "waypoint",
      entityId: args.waypointId,
    },
  ];
}
