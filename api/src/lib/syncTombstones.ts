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

/** Deleting a custom field DEFINITION. Definitions are never shared — they
 * belong to one account — so the fan-out is the owner alone. The values the
 * definition described are stripped from the owner's trip logs / places in
 * the same transaction, and those rows' own `updatedAt` bumps carry the strip
 * to other devices; this tombstone is only about the definition row. */
export function customFieldDefDeleteTombstones(args: {
  ownerId: string;
  defId: string;
}): TombstoneRow[] {
  return [
    { userId: args.ownerId, entityType: "customFieldDef", entityId: args.defId },
  ];
}

/**
 * DELETE /place-types/:id. Owner-private, so no fan-out: a type is never
 * shared, and a place OF that type reaches a sharee carrying its type id
 * without the sharee ever holding the type row itself.
 *
 * The definitions the delete cascades away carry their own tombstones — this
 * one is only for the type row.
 */
export function placeTypeDeleteTombstones(args: {
  ownerId: string;
  placeTypeId: string;
}): TombstoneRow[] {
  return [
    {
      userId: args.ownerId,
      entityType: "placeType",
      entityId: args.placeTypeId,
    },
  ];
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

/** DELETE /places/:id (and each row of the bulk cascade): the owner forgets
 * the place, its media and every revoked share row; each sharee forgets the
 * place and its place-level media. A sharee's signal here is deliberately
 * identical to an unshare (place tombstone) — continued-existence oracle
 * closed (§4.6.3). */
export function placeDeleteTombstones(args: {
  ownerId: string;
  placeId: string;
  /** Media DESTROYED with the place — its own attachments (photos, videos).
   * The owner forgets these as well as the sharees. */
  mediaIds: string[];
  shares: { id: string; sharedWithId: string }[];
  /** The place's linked route, if it had one. The ROUTE ITSELF SURVIVES —
   * Route.placeId is SetNull, so deleting a place unlinks its route rather
   * than destroying it. Only the sharees lose sight of it; the owner keeps it
   * as a standalone route and gets no tombstone. */
  routeId?: string | null;
  /** Standalone files (an import, a recorded track) that were linked as this
   * place's way. Same shape of survival as `routeId`: the file lives on in
   * the owner's Saved list, so the OWNER GETS NO TOMBSTONE — one here would
   * make every device delete the user's own file — and only the sharees, who
   * could see it solely through this place, are told to forget it. */
  unlinkedMediaIds?: string[];
}): TombstoneRow[] {
  const { ownerId, placeId, mediaIds, shares, routeId } = args;
  const unlinkedMediaIds = args.unlinkedMediaIds ?? [];
  const rows: TombstoneRow[] = [
    { userId: ownerId, entityType: "place", entityId: placeId },
    ...mediaIds.map(
      (id): TombstoneRow => ({ userId: ownerId, entityType: "media", entityId: id }),
    ),
    ...shares.map(
      (share): TombstoneRow => ({
        userId: ownerId,
        entityType: "placeShare",
        entityId: share.id,
      }),
    ),
  ];
  for (const share of shares) {
    rows.push({ userId: share.sharedWithId, entityType: "place", entityId: placeId });
    for (const id of mediaIds) {
      rows.push({ userId: share.sharedWithId, entityType: "media", entityId: id });
    }
    if (routeId) {
      rows.push({ userId: share.sharedWithId, entityType: "route", entityId: routeId });
    }
    for (const id of unlinkedMediaIds) {
      rows.push({ userId: share.sharedWithId, entityType: "media", entityId: id });
    }
  }
  return rows;
}

/** PATCH /media/:id/link, unlinking a standalone file from a place (a way
 * being replaced, or detached outright). The file survives — the owner keeps it
 * in Saved and gets NO tombstone — but every current sharee of that place
 * could see it only through the place, so each must forget it. The mirror of
 * a link, which needs no tombstone at all: a sharee simply gains a row on their
 * next delta. */
export function mediaUnlinkTombstones(args: {
  mediaId: string;
  shareeIds: string[];
}): TombstoneRow[] {
  const { mediaId, shareeIds } = args;
  return shareeIds.map((userId): TombstoneRow => ({
    userId,
    entityType: "media",
    entityId: mediaId,
  }));
}

/** DELETE /media/:id: the owner forgets it; if it was place-level media of a
 * shared place, every current sharee forgets it too. */
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

/** Share revocation (DELETE /places/:id/share/:userId, unshare-all, and the
 * per-share leg of unfriend): the sharee loses the whole place record — the
 * same `place` tombstone a place-delete would emit (§4.6.3) — plus its
 * place-level media; the place owner forgets the share row. */
export function shareRevokeTombstones(args: {
  placeOwnerId: string;
  shareeId: string;
  shareId: string;
  placeId: string;
  placeMediaIds: string[];
  /** The place's linked route, if any — the sharee loses it along with the
   * place record. Owner-side nothing changes; the route is still linked. */
  routeId?: string | null;
}): TombstoneRow[] {
  const { placeOwnerId, shareeId, shareId, placeId, placeMediaIds, routeId } =
    args;
  return [
    { userId: shareeId, entityType: "place", entityId: placeId },
    ...placeMediaIds.map(
      (id): TombstoneRow => ({ userId: shareeId, entityType: "media", entityId: id }),
    ),
    ...(routeId
      ? [{ userId: shareeId, entityType: "route" as const, entityId: routeId }]
      : []),
    { userId: placeOwnerId, entityType: "placeShare", entityId: shareId },
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
 * place, every current sharee of that place forgets it too (a linked route
 * follows place-level media visibility, not the owner-private waypoint rule).
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

/** Route UNLINKED from a place (including the incumbent displaced by a new
 * link): the sharees of that place lose sight of it, but the OWNER keeps it —
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

/** Links of a place that is being deleted. A PlaceLink is OWNER-PRIVATE — both
 * endpoints belong to `ownerId` and a link grants no visibility to anyone — so
 * the fan-out is one row per link for the owner alone, and no sharee ever
 * appears here. Without them the owner's mirror keeps link rows pointing at a
 * place that no longer exists, because the cascade that removes them writes
 * nothing to the delta. */
export function placeLinkDeleteTombstones(args: {
  ownerId: string;
  linkIds: string[];
}): TombstoneRow[] {
  const { ownerId, linkIds } = args;
  return linkIds.map(
    (linkId): TombstoneRow => ({ userId: ownerId, entityType: "placeLink", entityId: linkId }),
  );
}

/** A DIRECT share revoked (DELETE /shares/...), or the entity it pointed at
 * hard-deleted: the named users lose sight of it, the owner keeps it. The
 * sibling of routeUnlinkTombstones for the sharing path that does not run
 * through a place.
 *
 * Only routes appear here because only they ride delta sync among the directly
 * sharable entities — topo and GeoPDF jobs are fetched through their own list
 * endpoints, so a revoked job simply stops appearing there and the client
 * reconciles its downloaded artifact on the next fetch. (A place is shared
 * through PlaceShare, not Share, and has its own path.) */
export function directShareRevokeTombstones(args: {
  entityType: Extract<SyncEntityType, "route">;
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
 * place sharees (the place + its place-level media), friendship
 * counterparts (the edge), owners of places shared WITH the deleted user (the
 * PlaceShare row), DIRECT recipients of the deleted user's synced routes, and
 * place sharees who could see a route through one of those shared places. The
 * last two are the ones a cascade silently drops: the Share rows vanish with
 * the user and the route rows are hard-deleted, but neither writes a
 * tombstone, so without these the recipient's mirror keeps the item forever.
 *
 * PlaceLinks need no group of their own: they are owner-private, and the owner
 * is the account going away. */
export function accountDeleteTombstones(args: {
  userId: string;
  /** Place-level media ids, keyed by place id. */
  mediaIdsByPlace: Map<string, string[]>;
  placeSharesOut: { placeId: string; sharedWithId: string }[];
  placeSharesIn: { id: string; sharedById: string }[];
  friendships: { id: string; requesterId: string; addresseeId: string }[];
  directSharesOut: {
    entityType: Extract<SyncEntityType, "route">;
    entityId: string;
    sharedWithId: string;
  }[];
  /**
   * Routes of this account that OTHER users could see through a place share,
   * with the users who could see each. No visibility DIFF is needed here
   * (unlike an unlink or a single-place delete): the account delete
   * hard-deletes every one of these rows, so no surviving path can exist and
   * every current viewer loses the row.
   */
  placeInheritedOut: {
    entityType: Extract<SyncEntityType, "route">;
    entityId: string;
    userIds: string[];
  }[];
}): TombstoneRow[] {
  const {
    userId,
    mediaIdsByPlace,
    placeSharesOut,
    placeSharesIn,
    friendships,
    directSharesOut,
    placeInheritedOut,
  } = args;
  return [
    ...placeSharesOut.flatMap((share): TombstoneRow[] => [
      { userId: share.sharedWithId, entityType: "place", entityId: share.placeId },
      ...(mediaIdsByPlace.get(share.placeId) ?? []).map(
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
    ...placeSharesIn.map(
      (share): TombstoneRow => ({
        userId: share.sharedById,
        entityType: "placeShare",
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
    ...placeInheritedOut.flatMap((entity): TombstoneRow[] =>
      routeUnlinkTombstones({
        routeId: entity.entityId,
        shareeIds: entity.userIds,
      }),
    ),
  ];
}
