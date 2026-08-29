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
  /** The canyon's linked route, if it had one. The ROUTE ITSELF SURVIVES —
   * Route.canyonId is SetNull, so deleting a canyon unlinks its route rather
   * than destroying it. Only the sharees lose sight of it; the owner keeps it
   * as a standalone route and gets no tombstone. */
  routeId?: string | null;
}): TombstoneRow[] {
  const { ownerId, canyonId, mediaIds, shares, routeId } = args;
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
    if (routeId) {
      rows.push({ userId: share.sharedWithId, entityType: "route", entityId: routeId });
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
  /** The canyon's linked route, if any — the sharee loses it along with the
   * canyon record. Owner-side nothing changes; the route is still linked. */
  routeId?: string | null;
}): TombstoneRow[] {
  const { canyonOwnerId, shareeId, shareId, canyonId, canyonMediaIds, routeId } =
    args;
  return [
    { userId: shareeId, entityType: "canyon", entityId: canyonId },
    ...canyonMediaIds.map(
      (id): TombstoneRow => ({ userId: shareeId, entityType: "media", entityId: id }),
    ),
    ...(routeId
      ? [{ userId: shareeId, entityType: "route" as const, entityId: routeId }]
      : []),
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

/** DELETE /routes/:id: the owner forgets it; if it was LINKED to a shared
 * canyon, every current sharee of that canyon forgets it too (a linked route
 * follows canyon-level media visibility, not the owner-private waypoint rule).
 * `shareeIds` is empty for an unlinked route. */
export function routeDeleteTombstones(args: {
  ownerId: string;
  routeId: string;
  shareeIds: string[];
}): TombstoneRow[] {
  const { ownerId, routeId, shareeIds } = args;
  return [
    { userId: ownerId, entityType: "route", entityId: routeId },
    ...shareeIds.map(
      (userId): TombstoneRow => ({ userId, entityType: "route", entityId: routeId }),
    ),
  ];
}

/** Route UNLINKED from a canyon (including the incumbent displaced by a new
 * link): the sharees of that canyon lose sight of it, but the OWNER keeps it —
 * it survives as a standalone route. This is the sync-era trap of the linking
 * rule: visibility is revoked with no delete anywhere, so without these rows a
 * sharee's mirror would keep the route forever. */
export function routeUnlinkTombstones(args: {
  routeId: string;
  shareeIds: string[];
}): TombstoneRow[] {
  const { routeId, shareeIds } = args;
  return shareeIds.map(
    (userId): TombstoneRow => ({ userId, entityType: "route", entityId: routeId }),
  );
}

/** DELETE /waypoints/:id: the owner forgets it, and so does everyone who could
 * see it through a canyon share (a linked waypoint follows canyon-level media
 * visibility, exactly as a linked route does). `shareeIds` is empty for an
 * unlinked waypoint, which is the owner-private case. */
export function waypointDeleteTombstones(args: {
  ownerId: string;
  waypointId: string;
  shareeIds: string[];
}): TombstoneRow[] {
  const { ownerId, waypointId, shareeIds } = args;
  return [
    { userId: ownerId, entityType: "waypoint", entityId: waypointId },
    ...shareeIds.map(
      (userId): TombstoneRow => ({ userId, entityType: "waypoint", entityId: waypointId }),
    ),
  ];
}

/** A waypoint that specific users can no longer see, with no delete anywhere:
 * it was unlinked from the last canyon they shared, or that share was revoked,
 * or the canyon was deleted. The OWNER keeps it — it survives as a standalone
 * waypoint — so only the losing users appear here.
 *
 * `userIds` must come from waypointVisibilityLoss (lib/waypointLink.ts), never
 * from "the sharees of the canyon we just left": the link is many-to-many, and
 * a user still holding another shared path to the waypoint has lost nothing. */
export function waypointRevokeTombstones(args: {
  waypointId: string;
  userIds: string[];
}): TombstoneRow[] {
  const { waypointId, userIds } = args;
  return userIds.map(
    (userId): TombstoneRow => ({
      userId,
      entityType: "waypoint",
      entityId: waypointId,
    }),
  );
}

/** A DIRECT share revoked (DELETE /shares/...), or the entity it pointed at
 * hard-deleted: the named users lose sight of it, the owner keeps it. The
 * sibling of waypointRevokeTombstones/routeUnlinkTombstones for the sharing
 * path that does not run through a canyon.
 *
 * Only waypoints and routes appear here because only they ride delta sync —
 * topo and GeoPDF jobs are fetched through their own list endpoints, so a
 * revoked job simply stops appearing there and the client reconciles its
 * downloaded artifact on the next fetch. */
export function directShareRevokeTombstones(args: {
  entityType: Extract<SyncEntityType, "waypoint" | "route">;
  entityId: string;
  userIds: string[];
}): TombstoneRow[] {
  const { entityType, entityId, userIds } = args;
  return userIds.map((userId): TombstoneRow => ({ userId, entityType, entityId }));
}

/** DELETE /users/me: every OTHER user whose mirror held something of this
 * account's must forget it. The deleted user's own rows need no tombstone —
 * their account (and their whole tombstone log) is going away with them.
 *
 * Five counterpart groups, one per way another user could be holding a row:
 * canyon sharees (the canyon + its canyon-level media), friendship
 * counterparts (the edge), owners of canyons shared WITH the deleted user (the
 * CanyonShare row), DIRECT recipients of the deleted user's synced
 * waypoints/routes, and canyon sharees who could see a waypoint or route
 * through one of those shared canyons. The last two are the ones a cascade
 * silently drops: the Share rows vanish with the user and the waypoint/route
 * rows are hard-deleted, but neither writes a tombstone, so without these the
 * recipient's mirror keeps the item forever. */
export function accountDeleteTombstones(args: {
  userId: string;
  /** Canyon-level media ids, keyed by canyon id. */
  mediaIdsByCanyon: Map<string, string[]>;
  canyonSharesOut: { canyonId: string; sharedWithId: string }[];
  canyonSharesIn: { id: string; sharedById: string }[];
  friendships: { id: string; requesterId: string; addresseeId: string }[];
  directSharesOut: {
    entityType: Extract<SyncEntityType, "waypoint" | "route">;
    entityId: string;
    sharedWithId: string;
  }[];
  /**
   * Waypoints/routes of this account that OTHER users could see through a
   * canyon share, with the users who could see each. No visibility DIFF is
   * needed here (unlike an unlink or a single-canyon delete): the account
   * delete hard-deletes every one of these rows, so no surviving path can
   * exist and every current viewer loses the row.
   */
  canyonInheritedOut: {
    entityType: Extract<SyncEntityType, "waypoint" | "route">;
    entityId: string;
    userIds: string[];
  }[];
}): TombstoneRow[] {
  const {
    userId,
    mediaIdsByCanyon,
    canyonSharesOut,
    canyonSharesIn,
    friendships,
    directSharesOut,
    canyonInheritedOut,
  } = args;
  return [
    ...canyonSharesOut.flatMap((share): TombstoneRow[] => [
      { userId: share.sharedWithId, entityType: "canyon", entityId: share.canyonId },
      ...(mediaIdsByCanyon.get(share.canyonId) ?? []).map(
        (mediaId): TombstoneRow => ({
          userId: share.sharedWithId,
          entityType: "media",
          entityId: mediaId,
        }),
      ),
    ]),
    ...friendships.map(
      (f): TombstoneRow => ({
        userId: f.requesterId === userId ? f.addresseeId : f.requesterId,
        entityType: "friendship",
        entityId: f.id,
      }),
    ),
    ...canyonSharesIn.map(
      (share): TombstoneRow => ({
        userId: share.sharedById,
        entityType: "canyonShare",
        entityId: share.id,
      }),
    ),
    ...directSharesOut.map(
      (share): TombstoneRow => ({
        userId: share.sharedWithId,
        entityType: share.entityType,
        entityId: share.entityId,
      }),
    ),
    ...canyonInheritedOut.flatMap((entity): TombstoneRow[] =>
      entity.entityType === "waypoint"
        ? waypointRevokeTombstones({
            waypointId: entity.entityId,
            userIds: entity.userIds,
          })
        : routeUnlinkTombstones({
            routeId: entity.entityId,
            shareeIds: entity.userIds,
          }),
    ),
  ];
}
