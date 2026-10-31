import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { placeIdOfMedia } from "../lib/mediaLink";
import { AppError, malformed } from "../middleware/errorHandler";
import { friendsSearchLimiter } from "../middleware/rateLimit";
import { getParam } from "../lib/getParam";
import {
  say,
  normalizeUserUiPreferences,
  computeLeaderboard,
  currentSeason,
  isPodiumWeek,
  medalFor,
  previousSeason,
  SYSTEM_PLACE_TYPE_IDS,
  type LeaderboardResponse,
  type Season,
  isSharableEntityType,
  type BulkShareItem,
  type FriendShareRow,
  type SharableEntityType,
} from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";
import { sendPushToUser } from "../services/push";
import { logger } from "../lib/logger";
import {
  friendshipDeleteTombstones,
  shareRevokeTombstones,
  writeTombstones,
} from "../lib/syncTombstones";
import {
  filterOwnedEntityIds,
  hasPlaceInheritedAccess,
  revokeAllSharesBetween,
} from "../lib/shareAccess";
import { parseBulkShareItems } from "../lib/bulkShare";
import {
  revokeDirectShares,
  syncedEntityType,
  type DirectShareRevocation,
} from "../lib/revokeDirectShares";

export async function wantsInAppNotification(
  userId: string,
  key: "friendRequestInApp" | "shareInApp",
): Promise<boolean> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { uiPreferences: true },
  });
  if (!target) return false;
  return normalizeUserUiPreferences(target.uiPreferences).notifications[key];
}

/** A write refused by a unique index. For a friendship that is
 *  `friendships_pair_key`: the other of two racing writes for the same pair
 *  landed first. Guard: friendPairRace.unit.test.ts. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/** `userId`, its addressee, says yes to a pending request: the row is
 *  accepted (which moves `updatedAt`, the delta pull's watermark), their own
 *  prompt for it goes, and the requester is told if they want to be. */
async function acceptFriendRequest(
  friendship: { id: string; requesterId: string },
  userId: string,
) {
  const { id, requesterId } = friendship;
  const notifyRequester = await wantsInAppNotification(
    requesterId,
    "friendRequestInApp",
  );

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.friendship.update({
      where: { id },
      data: { status: "accepted" },
    });
    // Purge this user's own friend_request notification, mirroring decline:
    // otherwise a stale actionable notification survives the
    // accept and later 400s from the Notifications panel.
    await tx.notification.deleteMany({
      where: {
        userId,
        type: "friend_request",
        payload: { path: ["friendshipId"], equals: id },
      },
    });
    if (notifyRequester) {
      // Reference IDs only — username is resolved at read time.
      await tx.notification.create({
        data: {
          userId: requesterId,
          type: "friend_request_accepted",
          payload: {
            friendshipId: id,
            acceptedById: userId,
          },
        },
      });
    }
    return u;
  });
  if (notifyRequester) {
    // Best-effort push after commit; generic title + opaque IDs only.
    void sendPushToUser(requesterId, {
      type: "friend_request_accepted",
      friendshipId: id,
    });
  }
  return updated;
}

/** One attempt at POST /friends/request. Throws P2002 when another write
 *  gives the pair its row between the read and the insert. */
async function requestOrAccept(userId: string, addresseeId: string) {
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId },
        { requesterId: addresseeId, addresseeId: userId },
      ],
    },
  });
  if (existing) {
    if (existing.status === "blocked")
      throw new AppError(403, say`Couldn't send that friend request.`);
    if (existing.status === "accepted")
      throw new AppError(409, say`You're already friends.`);
    if (existing.requesterId === userId)
      throw new AppError(
        409,
        say`A friend request between you is already waiting.`,
      );
    // Their request to this user is the one waiting. Both have asked, so
    // this is the yes: the same friendship whether the two requests were a
    // year apart or raced. 200, not 201: nothing was created.
    return {
      status: 200,
      friendship: await acceptFriendRequest(existing, userId),
    };
  }

  const notifyAddressee = await wantsInAppNotification(
    addresseeId,
    "friendRequestInApp",
  );

  // Create friendship first so the notification can reference its real ID
  // atomically inside the same transaction.
  const friendship = await prisma.$transaction(async (tx) => {
    const created = await tx.friendship.create({
      data: {
        requesterId: userId,
        addresseeId,
        status: "pending",
      },
    });
    if (notifyAddressee) {
      // Reference IDs only — username is resolved at read time.
      await tx.notification.create({
        data: {
          userId: addresseeId,
          type: "friend_request",
          payload: {
            friendshipId: created.id,
            requesterId: userId,
          },
        },
      });
    }
    return created;
  });
  if (notifyAddressee) {
    // Best-effort push after commit; generic title + opaque IDs only
    // (privacy rule — see services/push.ts).
    void sendPushToUser(addresseeId, {
      type: "friend_request",
      friendshipId: friendship.id,
    });
  }
  return { status: 201, friendship };
}

const router = Router();

// ── GET /friends ──────────────────────────────────────────────
// Returns all accepted friends for the current user
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const friendships = await prisma.friendship.findMany({
      where: {
        status: "accepted",
        OR: [{ requesterId: user.id }, { addresseeId: user.id }],
      },
      include: {
        requester: { select: { id: true, username: true } },
        addressee: { select: { id: true, username: true } },
      },
    });

    const friends = friendships.map(
      (f: {
        id: string;
        requesterId: string;
        addresseeId: string;
        requester: { id: string; username: string };
        addressee: { id: string; username: string };
      }) => {
        const friend = f.requesterId === user.id ? f.addressee : f.requester;
        return { ...friend, friendshipId: f.id };
      },
    );

    res.json(friends);
  },
);

// ── GET /friends/leaderboard ──────────────────────────────────
// The user and their friends who have joined, ranked by distinct canyons this
// season (shared/src/leaderboard.ts). Someone who has not joined gets
// `{ joined: false }` and nothing else: no peeking without taking part.
router.get(
  "/leaderboard",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    if (!normalizeUserUiPreferences(user.uiPreferences).leaderboardOptIn) {
      res.json({ joined: false } satisfies LeaderboardResponse);
      return;
    }

    const friendships = await prisma.friendship.findMany({
      where: {
        status: "accepted",
        OR: [{ requesterId: user.id }, { addresseeId: user.id }],
      },
      include: {
        requester: {
          select: { id: true, username: true, uiPreferences: true },
        },
        addressee: {
          select: { id: true, username: true, uiPreferences: true },
        },
      },
    });
    const { participants, notJoined } = collectLeaderboardParticipants(
      { id: user.id, username: user.username },
      friendships,
    );

    const now = new Date();
    const season = currentSeason(now);
    const entries = await buildLeaderboard(participants, season);

    let podium: Extract<LeaderboardResponse, { joined: true }>["podium"] = null;
    if (isPodiumWeek(now)) {
      const last = previousSeason(now);
      const mine = (await buildLeaderboard(participants, last)).find(
        (entry) => entry.userId === user.id,
      );
      if (mine && medalFor(mine, participants.size)) {
        podium = {
          season: last.label,
          rank: mine.rank,
          canyonCount: mine.canyonCount,
        };
      }
    }

    res.json({
      joined: true,
      season: season.label,
      entries: entries.map((entry) => ({
        ...entry,
        isSelf: entry.userId === user.id,
      })),
      notJoined,
      podium,
    } satisfies LeaderboardResponse);
  },
);

type LeaderboardParty = {
  id: string;
  username: string;
  uiPreferences: unknown;
};

/**
 * Who is on the board: the user and every accepted friend who has joined, as
 * userId → username; the rest of their friends by username, for the nudge.
 * Pure, so the consent boundary is unit-tested (leaderboard.unit.test.ts).
 */
export function collectLeaderboardParticipants(
  self: { id: string; username: string },
  friendships: {
    requesterId: string;
    requester: LeaderboardParty;
    addressee: LeaderboardParty;
  }[],
): { participants: Map<string, string>; notJoined: string[] } {
  const participants = new Map([[self.id, self.username]]);
  const notJoined: string[] = [];
  for (const f of friendships) {
    const friend = f.requesterId === self.id ? f.addressee : f.requester;
    if (normalizeUserUiPreferences(friend.uiPreferences).leaderboardOptIn) {
      participants.set(friend.id, friend.username);
    } else {
      notJoined.push(friend.username);
    }
  }
  return {
    participants,
    notJoined: notJoined.sort((a, b) => a.localeCompare(b)),
  };
}

/** One query for every participant's canyon links in the season. Only the
 *  built-in Canyon type scores: a user's own types and campsites do not. */
async function buildLeaderboard(
  participants: Map<string, string>,
  season: Season,
) {
  const trips = await prisma.tripLog.findMany({
    where: {
      userId: { in: [...participants.keys()] },
      date: { gte: season.start, lt: season.end },
    },
    select: {
      userId: true,
      places: {
        where: { place: { placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon } },
        select: { placeId: true },
      },
    },
  });
  const placeIds = new Map<string, string[]>();
  for (const trip of trips) {
    const ids = placeIds.get(trip.userId) ?? [];
    ids.push(...trip.places.map((link) => link.placeId));
    placeIds.set(trip.userId, ids);
  }
  return computeLeaderboard(
    [...participants].map(([userId, username]) => ({
      userId,
      username,
      placeIds: placeIds.get(userId) ?? [],
    })),
  );
}

// ── GET /friends/requests ─────────────────────────────────────
// Returns all pending friend requests received by the current user
router.get(
  "/requests",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const requests = await prisma.friendship.findMany({
      where: {
        addresseeId: user.id,
        status: "pending",
      },
      include: {
        requester: { select: { id: true, username: true } },
      },
    });

    res.json(requests);
  },
);

// ── POST /friends/request ─────────────────────────────────────
// Send a friend request to another user, or accept the one they sent.
// 201 with the pending row, or 200 with the row now accepted.
router.post(
  "/request",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const { addresseeId } = req.body;
    if (!addresseeId) throw malformed("addresseeId is required");
    if (addresseeId === user.id)
      throw new AppError(
        400,
        say`You can't send a friend request to yourself.`,
      );

    const addressee = await prisma.user.findUnique({
      where: { id: addresseeId },
    });
    // Same refusal a blocked pair gets: a distinct 404 would tell the caller
    // which user ids exist.
    if (!addressee)
      throw new AppError(403, say`Couldn't send that friend request.`);

    // Lost to a racing request or redeem for the same pair: go again, and
    // this attempt reads the row that won, so a race ends where the same two
    // requests would have ended a year apart.
    const { status, friendship } = await requestOrAccept(user.id, addresseeId)
      .catch((err: unknown) => {
        if (!isUniqueViolation(err)) throw err;
        return requestOrAccept(user.id, addresseeId);
      })
      .catch((err: unknown) => {
        if (!isUniqueViolation(err)) throw err;
        // The pair's row came, went and came again: nothing was made here.
        throw new AppError(
          409,
          say`A friend request between you is already waiting.`,
        );
      });

    res.status(status).json(friendship);
  },
);

// ── PATCH /friends/:id/accept ─────────────────────────────────
// Accept a pending friend request
router.patch(
  "/:id/accept",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship)
      throw new AppError(404, say`Couldn't find that friend request.`);
    if (friendship.addresseeId !== user.id)
      throw new AppError(
        403,
        say`Only the person a friend request was sent to can accept it.`,
      );
    if (friendship.status !== "pending")
      throw new AppError(
        400,
        say`That friend request has already been answered.`,
      );

    res.json(await acceptFriendRequest(friendship, user.id));
  },
);

// ── PATCH /friends/:id/decline ────────────────────────────────
// Decline a pending friend request
router.patch(
  "/:id/decline",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship)
      throw new AppError(404, say`Couldn't find that friend request.`);
    if (friendship.addresseeId !== user.id)
      throw new AppError(
        403,
        say`Only the person a friend request was sent to can decline it.`,
      );
    if (friendship.status !== "pending")
      throw new AppError(
        400,
        say`That friend request has already been answered.`,
      );

    // Delete the friendship and purge this user's own friend_request
    // notification that referenced it (clean the row, don't rely on
    // the read-time filter alone). Both parties' mirrors must forget the edge
    // (sync tombstones, same transaction).
    await prisma.$transaction([
      prisma.notification.deleteMany({
        where: {
          userId: user.id,
          type: "friend_request",
          payload: { path: ["friendshipId"], equals: id },
        },
      }),
      prisma.syncTombstone.createMany({
        data: friendshipDeleteTombstones({
          friendshipId: id,
          userIds: [friendship.requesterId, friendship.addresseeId],
        }),
      }),
      prisma.friendship.delete({ where: { id } }),
    ]);

    res.status(204).send();
  },
);

// ── DELETE /friends/:id ───────────────────────────────────────
// Remove an existing friend
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship) throw new AppError(404, say`Couldn't find that friend.`);
    if (friendship.status !== "accepted")
      throw new AppError(400, say`You aren't friends with that person.`);

    // Either party can remove a friend
    const isMember =
      friendship.requesterId === user.id || friendship.addresseeId === user.id;
    if (!isMember)
      throw new AppError(403, say`You don't have permission to do that.`);

    // Remove the friendship and any place shares between the two users
    const otherId =
      friendship.requesterId === user.id
        ? friendship.addresseeId
        : friendship.requesterId;

    await prisma.$transaction(async (tx) => {
      // The place shares in both directions, taken from their delete: each one
      // gets its tombstones and its recipient's place_shared purge below, and
      // a share made after a separate read would get neither.
      const revokedShares = await tx.$queryRaw<
        {
          id: string;
          placeId: string;
          sharedById: string;
          sharedWithId: string;
        }[]
      >`DELETE FROM place_shares
         WHERE (shared_by_id = ${user.id} AND shared_with_id = ${otherId})
            OR (shared_by_id = ${otherId} AND shared_with_id = ${user.id})
        RETURNING id, place_id AS "placeId", shared_by_id AS "sharedById",
                  shared_with_id AS "sharedWithId"`;

      // Place-level media ids of every place whose share is being revoked —
      // each sharee's mirror must forget the place AND its media (sync
      // tombstone fan-out, written in the same transaction below).
      const revokedPlaceIds = revokedShares.map((s) => s.placeId);
      const revokedPlaceMedia =
        revokedPlaceIds.length > 0
          ? await tx.media.findMany({
              where: { linkedType: "place", linkedId: { in: revokedPlaceIds } },
              select: { id: true, linkedType: true, linkedId: true },
            })
          : [];
      const mediaIdsByPlace = new Map<string, string[]>();
      for (const m of revokedPlaceMedia) {
        const placeId = placeIdOfMedia(m);
        if (placeId === null) continue;
        const list = mediaIdsByPlace.get(placeId) ?? [];
        list.push(m.id);
        mediaIdsByPlace.set(placeId, list);
      }
      // A linked route rides with the shared place record, so unfriending
      // revokes it too.
      const revokedRoutes =
        revokedPlaceIds.length > 0
          ? await tx.route.findMany({
              where: { placeId: { in: revokedPlaceIds } },
              select: { id: true, placeId: true },
            })
          : [];
      const routeIdByPlace = new Map(
        revokedRoutes.map((route) => [route.placeId!, route.id]),
      );
      const unfriendTombstones = [
        ...friendshipDeleteTombstones({
          friendshipId: id,
          userIds: [friendship.requesterId, friendship.addresseeId],
        }),
        ...revokedShares.flatMap((s) =>
          shareRevokeTombstones({
            placeOwnerId: s.sharedById,
            shareeId: s.sharedWithId,
            shareId: s.id,
            placeId: s.placeId,
            placeMediaIds: mediaIdsByPlace.get(s.placeId) ?? [],
            routeId: routeIdByPlace.get(s.placeId) ?? null,
          }),
        ),
      ];
      await writeTombstones(tx, unfriendTombstones);
      // Every OTHER share type between the two users: direct per-item Shares
      // (waypoint / route / topo job) in both directions, plus
      // file sends the recipient has not taken yet. Place shares are the
      // block above; this is the rest of the same promise — unfriending takes
      // back all live access, not just places.
      await revokeAllSharesBetween(tx, user.id, otherId);
      // Drop the recipient's residual place_shared notifications for each
      // place whose share was just revoked.
      for (const s of revokedShares) {
        await tx.notification.deleteMany({
          where: {
            userId: s.sharedWithId,
            type: "place_shared",
            payload: { path: ["placeId"], equals: s.placeId },
          },
        });
      }
      // Purge the friend_request / friend_request_accepted notifications that
      // referenced this friendship on either party's side.
      await tx.notification.deleteMany({
        where: {
          userId: { in: [friendship.requesterId, friendship.addresseeId] },
          type: { in: ["friend_request", "friend_request_accepted"] },
          payload: { path: ["friendshipId"], equals: id },
        },
      });
      await tx.friendship.delete({ where: { id } });
    });

    res.status(204).send();
  },
);

// ── Sharing audit ─────────────────────────────────────────────
//
// "What does Bob see, and how do I take it all back?" Sharing is authored
// per-place, so the per-person view had no surface; these two routes are it.
//
// `:id` is a FRIENDSHIP id, matching every other `/friends/:id/*` route
// (accept / decline / DELETE). That is also the authorization anchor: shares
// only ever exist between friends (POST /places/:id/share enforces it), so
// resolving the friendship and asserting membership is the whole check.
//
// ACCESS DECISION — why these do NOT call lib/placeAccess.ts:
// those helpers answer "what is my role on THIS place" and exist to vet an
// arbitrary caller-supplied place id. These routes accept no place id: the
// set is derived from the caller's own ownership via `place: { ownerId }`,
// so a place the caller can't see is simply absent and there is no id to
// vet. Same pattern (and same rationale) as GET /places/tracks and GET
// /places. Filtering on the place's `ownerId` rather than the share's
// `sharedById` is deliberate: it derives from ownership directly instead of
// trusting that `sharedById` still equals the owner.
//
// EMAIL: these responses join no User rows at all — the friend's identity is
// already known from the friendship, and place rows carry no user fields. The
// username-only rule for /friends is therefore structural here, not a `select`
// that could drift (see the `select` below: id/name/createdAt only).

/**
 * Places I OWN that are shared with `friendId`. Deriving the set from the
 * place's `ownerId` (not the share's `sharedById`) is what makes it
 * impossible to list or revoke a share on a place the caller doesn't own.
 */
export function ownedSharesToFriendWhere(userId: string, friendId: string) {
  return { sharedWithId: friendId, place: { ownerId: userId } };
}

/** Places `friendId` owns that are shared with me. The mirror image. */
export function receivedSharesFromFriendWhere(
  userId: string,
  friendId: string,
) {
  return { sharedWithId: userId, place: { ownerId: friendId } };
}

/** A `Share` row bound for the audit list, before its name is looked up. */
type DirectShareRef = {
  entityType: SharableEntityType;
  entityId: string;
  sharedAt: Date;
};

/**
 * Direct `Share` rows (waypoint / route / LiDAR topo) that one person
 * can see and ANOTHER person owns — the non-place half of both directions.
 *
 * WHY IT IS NOT ONE WHERE CLAUSE, unlike the place pair above: `Share` is
 * polymorphic with no foreign key (see `directlySharedIds` in
 * lib/shareAccess.ts), so `place: { ownerId }` has no equivalent — Prisma
 * cannot join through `entityId`. Filtering on the row's own `sharedById` would
 * be one query, and is exactly what the place helpers refuse to do: it trusts
 * a denormalised value instead of deriving from ownership. So the ownership arm
 * is a second pass through `filterOwnedEntityIds`, the batch owner check the
 * bulk share already runs — four extra queries at most, whatever the list
 * length, and a row the `ownerId` does not own cannot enter the result or be
 * revoked by the bulk delete that reuses this.
 *
 * ponytail: reads the recipient's whole received-share set before narrowing by
 * owner. Fine at personal-account scale (tens of rows, the same assumption
 * `directlySharedIds` documents); if that stops holding, the upgrade path is a
 * `sharedById` index used as a PREFILTER with the ownership check kept as the
 * decision.
 */
async function directSharesBetween(args: {
  ownerId: string;
  sharedWithId: string;
}): Promise<DirectShareRef[]> {
  const rows = await prisma.share.findMany({
    where: { sharedWithId: args.sharedWithId },
    select: { entityType: true, entityId: true, createdAt: true },
  });

  const idsByType = new Map<SharableEntityType, string[]>();
  const refs: DirectShareRef[] = [];
  for (const row of rows) {
    if (!isSharableEntityType(row.entityType)) {
      // Unwritable through any route (POST /shares and /bulk-share both parse
      // the vocabulary first), so this is a corrupt row rather than a case.
      // Skipped rather than thrown: one bad row must not 500 an audit screen
      // whose whole job is to show the user what is shared.
      logger.warn(
        { entityType: row.entityType },
        "share_row_unknown_entity_type",
      );
      continue;
    }
    const entityType = row.entityType;
    refs.push({ entityType, entityId: row.entityId, sharedAt: row.createdAt });
    idsByType.set(entityType, [
      ...(idsByType.get(entityType) ?? []),
      row.entityId,
    ]);
  }

  const ownedByType = new Map<SharableEntityType, Set<string>>();
  await Promise.all(
    [...idsByType].map(async ([entityType, ids]) => {
      ownedByType.set(
        entityType,
        await filterOwnedEntityIds(args.ownerId, entityType, ids),
      );
    }),
  );

  return refs.filter(
    (ref) => ownedByType.get(ref.entityType)?.has(ref.entityId) ?? false,
  );
}

/**
 * Put a name on each direct-share row. One query per type present, and only
 * over the ids that survived the ownership filter.
 *
 * A name can come back null — a LiDAR topo saved without one. `shareRowTitle` (shared/src/sharing.ts) is what
 * turns that into words, on both clients, rather than each surface inventing
 * its own "Untitled".
 */
async function nameDirectShares(
  refs: DirectShareRef[],
  /**
   * The user these rows are shared WITH, when that user is the caller — i.e.
   * the received direction. Given, each waypoint/route row is checked for a
   * surviving place arm and marked `alsoViaPlace`, because a Remove on such a
   * row would appear to work and be undone by the next delta pull. Omitted for
   * the forward direction, where the question is meaningless: they are the
   * caller's own rows.
   */
  inheritedForUserId?: string,
): Promise<FriendShareRow[]> {
  const idsByType = new Map<SharableEntityType, string[]>();
  for (const ref of refs) {
    idsByType.set(ref.entityType, [
      ...(idsByType.get(ref.entityType) ?? []),
      ref.entityId,
    ]);
  }

  const nameById = new Map<string, string | null>();
  const key = (entityType: SharableEntityType, entityId: string) =>
    `${entityType}:${entityId}`;

  await Promise.all(
    [...idsByType].map(async ([entityType, ids]) => {
      const rows =
        entityType === "route"
          ? await prisma.route.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true },
            })
          : await prisma.topoJob.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true },
            });
      for (const row of rows) {
        nameById.set(key(entityType, row.id), row.name ?? null);
      }
    }),
  );

  // Only a route can have a place arm at all (a job has no place), so this is
  // at most one query per route in a list that is tens of rows long.
  const alsoViaPlace = new Set<string>();
  if (inheritedForUserId !== undefined) {
    await Promise.all(
      refs.map(async (ref) => {
        const synced = syncedEntityType(ref.entityType);
        if (synced === null) return;
        if (
          await hasPlaceInheritedAccess(
            inheritedForUserId,
            synced,
            ref.entityId,
          )
        ) {
          alsoViaPlace.add(key(ref.entityType, ref.entityId));
        }
      }),
    );
  }

  return refs.map((ref) => ({
    entityType: ref.entityType,
    entityId: ref.entityId,
    name: nameById.get(key(ref.entityType, ref.entityId)) ?? null,
    sharedAt: ref.sharedAt.toISOString(),
    ...(alsoViaPlace.has(key(ref.entityType, ref.entityId))
      ? { alsoViaPlace: true as const }
      : {}),
  }));
}

/** Newest grant first, whatever kind it is — the order both clients render. */
function byNewestShare(rows: FriendShareRow[]): FriendShareRow[] {
  return [...rows].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
}

/**
 * Narrow a set of audit rows to the ones a request named, or leave it whole
 * when it named none.
 *
 * "No items" means ALL — the bulk revoke's original contract, which Logjam
 * Web's "Unshare all" still uses. An EMPTY array is not the same thing and
 * revokes nothing: a client that computed a list and came up with none must
 * not be read as having asked for everything.
 */
export function selectRequested<
  T extends { entityType: string; entityId: string },
>(rows: T[], requested: BulkShareItem[] | null): T[] {
  if (requested === null) return rows;
  const wanted = new Set(
    requested.map((item) => `${item.entityType}:${item.entityId}`),
  );
  return rows.filter((row) => wanted.has(`${row.entityType}:${row.entityId}`));
}

// Resolve a friendship the caller is a member of, and return the other party's
// id. 403 (not 404) for a non-member mirrors DELETE /friends/:id and
// /:id/accept — the anti-oracle 404 rule is scoped to place ids, and no place
// id is accepted here.
export async function resolveFriendCounterpart(
  friendshipId: string,
  userId: string,
): Promise<string> {
  const friendship = await prisma.friendship.findUnique({
    where: { id: friendshipId },
  });
  if (!friendship) throw new AppError(404, say`Couldn't find that friend.`);
  if (friendship.status !== "accepted")
    throw new AppError(400, say`You aren't friends with that person.`);
  const isMember =
    friendship.requesterId === userId || friendship.addresseeId === userId;
  if (!isMember)
    throw new AppError(403, say`You don't have permission to do that.`);
  return friendship.requesterId === userId
    ? friendship.addresseeId
    : friendship.requesterId;
}

// ── GET /friends/:id/shares ───────────────────────────────────
// Both directions of the sharing relationship with one friend, in one trip,
// across BOTH share tables.
router.get(
  "/:id/shares",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const friendId = await resolveFriendCounterpart(
      getParam(req.params.id),
      user.id,
    );

    // Minimal projection: a label and a date. No coords, no notes — an audit
    // list needs to name the thing, not carry it.
    const select = {
      id: true,
      place: { select: { id: true, name: true } },
      createdAt: true,
    };

    const [placesTheirs, placesMine, directTheirs, directMine] =
      await Promise.all([
        // Places I own that this friend can see.
        prisma.placeShare.findMany({
          where: ownedSharesToFriendWhere(user.id, friendId),
          select,
          orderBy: { createdAt: "desc" },
        }),
        // Places this friend owns that I can see.
        prisma.placeShare.findMany({
          where: receivedSharesFromFriendWhere(user.id, friendId),
          select,
          orderBy: { createdAt: "desc" },
        }),
        // The same two questions of the `Share` table.
        directSharesBetween({ ownerId: user.id, sharedWithId: friendId }),
        directSharesBetween({ ownerId: friendId, sharedWithId: user.id }),
      ]);

    const shapePlaces = (rows: typeof placesTheirs): FriendShareRow[] =>
      rows.map((row) => ({
        entityType: "place" as const,
        entityId: row.place.id,
        name: row.place.name,
        sharedAt: row.createdAt.toISOString(),
      }));

    const [itemsTheirs, itemsMine] = await Promise.all([
      nameDirectShares(directTheirs),
      nameDirectShares(directMine, user.id),
    ]);

    res.json({
      sharedWithThem: byNewestShare([
        ...shapePlaces(placesTheirs),
        ...itemsTheirs,
      ]),
      sharedWithYou: byNewestShare([...shapePlaces(placesMine), ...itemsMine]),
    });
  },
);

// ── DELETE /friends/:id/shares ────────────────────────────────
// "Unshare all with this friend" — or unshare the ones named in the body.
//
// ONE DIRECTION ONLY, by design: it never touches what the friend shares with
// me (that is their grant to withdraw, or mine to drop one row at a time via
// DELETE /places/:id/share/me and DELETE /shares/:type/:id/me). The friendship
// itself survives — that is the difference from DELETE /friends/:id, which
// revokes both directions and is the existing bulk lever if you want the person
// gone entirely.
//
// Body: `{ items?: [{ entityType, entityId }] }`. Absent means everything I own
// that this friend can see, across both tables — the original contract, still
// what Logjam Web's "Unshare all" relies on. Present means those of my grants
// and no others, which is what a phone multi-select needs: the subset it lets
// the user pick is the subset it must revoke, and it must not become "all"
// through a client bug (see `selectRequested`).
//
// Ids in the body authorize NOTHING. Both arms intersect the request with a set
// derived from the caller's own ownership, so an id belonging to a stranger's
// place is simply absent from that set — the response is a count, so it cannot
// report back whether the id existed (the anti-oracle rule).
router.delete(
  "/:id/shares",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const friendId = await resolveFriendCounterpart(
      getParam(req.params.id),
      user.id,
    );

    const body = req.body ?? {};
    // Reuses the bulk-share parser: same vocabulary, same 200-item cap, same
    // 413 (api/AGENTS.md's bulk rule), and one place that decides what an item
    // reference looks like on the wire.
    const requested =
      body.items === undefined || body.items === null
        ? null
        : parseBulkShareItems(body.items);

    // Collect before deleting so each revoked place's residual place_shared
    // notification can be purged too, exactly as DELETE /friends/:id
    // does.
    const allPlaceShares = await prisma.placeShare.findMany({
      where: ownedSharesToFriendWhere(user.id, friendId),
      select: { id: true, placeId: true },
    });
    const revoked = selectRequested(
      allPlaceShares.map((row) => ({
        ...row,
        entityType: "place",
        entityId: row.placeId,
      })),
      requested,
    );

    if (revoked.length > 0) {
      // The friend's mirror must forget each place + its place-level media;
      // the owner's mirror forgets the share rows (sync tombstones, same
      // transaction as the revoke).
      const placeMedia = await prisma.media.findMany({
        where: {
          linkedType: "place",
          linkedId: { in: revoked.map((r) => r.placeId) },
        },
        select: { id: true, linkedType: true, linkedId: true },
      });
      const mediaIdsByPlace = new Map<string, string[]>();
      for (const m of placeMedia) {
        const placeId = placeIdOfMedia(m);
        if (placeId === null) continue;
        const list = mediaIdsByPlace.get(placeId) ?? [];
        list.push(m.id);
        mediaIdsByPlace.set(placeId, list);
      }
      // A linked route rides with the shared place record.
      const revokedRoutes = await prisma.route.findMany({
        where: { placeId: { in: revoked.map((r) => r.placeId) } },
        select: { id: true, placeId: true },
      });
      const routeIdByPlace = new Map(
        revokedRoutes.map((route) => [route.placeId!, route.id]),
      );
      await prisma.$transaction(async (tx) => {
        await tx.syncTombstone.createMany({
          data: revoked.flatMap((r) =>
            shareRevokeTombstones({
              placeOwnerId: user.id,
              shareeId: friendId,
              shareId: r.id,
              placeId: r.placeId,
              placeMediaIds: mediaIdsByPlace.get(r.placeId) ?? [],
              routeId: routeIdByPlace.get(r.placeId) ?? null,
            }),
          ),
        });
        await tx.placeShare.deleteMany({
          where: { id: { in: revoked.map((r) => r.id) } },
        });
        for (const r of revoked) {
          await tx.notification.deleteMany({
            where: {
              userId: friendId,
              type: "place_shared",
              payload: { path: ["placeId"], equals: r.placeId },
            },
          });
        }
      });
    }

    // The `Share` table's half. Everything a direct revoke has to do — the row,
    // the recipient's notification, the delta bump, the tombstone only where no
    // place arm survives — is lib/revokeDirectShares.ts, shared with the
    // single revoke in routes/shares.ts.
    const directRevocations: DirectShareRevocation[] = selectRequested(
      await directSharesBetween({ ownerId: user.id, sharedWithId: friendId }),
      requested,
    ).map((ref) => ({
      entityType: ref.entityType,
      entityId: ref.entityId,
      sharedWithId: friendId,
    }));
    const itemsRevokedCount = await revokeDirectShares(directRevocations);

    // Counts only — never the names/coords of what was revoked.
    logger.info(
      {
        userId: user.id,
        revokedCount: revoked.length,
        itemsRevokedCount,
        subset: requested !== null,
      },
      "shares_bulk_revoked",
    );

    res.json({
      // One number, because one action: the client's sentence says "N things
      // are no longer shared with Bob" and does not care which table they
      // came from.
      revokedCount: revoked.length + itemsRevokedCount,
      placesRevokedCount: revoked.length,
      itemsRevokedCount,
    });
  },
);

// ── GET /friends/search ───────────────────────────────────────
// Search for users by username to send friend requests
router.get(
  "/search",
  requireAuth,
  friendsSearchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const { q } = req.query;
    if (!q || typeof q !== "string" || q.length < 3) {
      throw new AppError(400, say`Type at least 3 characters to search.`);
    }

    // Same where for the page and the count, so the total reveals nothing
    // the matching usernames would not.
    const where = {
      username: { contains: q, mode: "insensitive" as const },
      id: { not: user.id },
    };
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, username: true },
        take: 10,
      }),
      prisma.user.count({ where }),
    ]);

    res.set("X-Total-Count", String(total));
    res.json(users);
  },
);

export default router;
