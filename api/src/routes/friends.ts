import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { friendsSearchLimiter } from "../middleware/rateLimit";
import { getParam } from "../lib/getParam";
import { normalizeUserUiPreferences } from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";
import { sendPushToUser } from "../services/push";
import { logger } from "../lib/logger";
import {
  friendshipDeleteTombstones,
  shareRevokeTombstones,
  writeTombstones,
} from "../lib/syncTombstones";

async function wantsInAppNotification(
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
// Send a friend request to another user
router.post(
  "/request",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const { addresseeId } = req.body;
    if (!addresseeId) throw new AppError(400, "addresseeId is required");
    if (addresseeId === user.id)
      throw new AppError(400, "You cannot send a friend request to yourself");

    const addressee = await prisma.user.findUnique({
      where: { id: addresseeId },
    });
    if (!addressee) throw new AppError(404, "User not found");

    // Check for any existing friendship or pending request in either direction
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: user.id, addresseeId },
          { requesterId: addresseeId, addresseeId: user.id },
        ],
      },
    });

    if (existing) {
      if (existing.status === "accepted")
        throw new AppError(409, "Already friends");
      if (existing.status === "pending")
        throw new AppError(409, "Friend request already pending");
      if (existing.status === "blocked")
        throw new AppError(403, "Unable to send friend request");
    }

    const notifyAddressee = await wantsInAppNotification(addresseeId, "friendRequestInApp");

    // Create friendship first so the notification can reference its real ID
    // atomically inside the same transaction.
    const friendship = await prisma.$transaction(async (tx) => {
      const created = await tx.friendship.create({
        data: {
          requesterId: user.id,
          addresseeId,
          status: "pending",
        },
      });
      if (notifyAddressee) {
        // Reference IDs only — username is resolved at read time (PRIV-005).
        await tx.notification.create({
          data: {
            userId: addresseeId,
            type: "friend_request",
            payload: {
              friendshipId: created.id,
              requesterId: user.id,
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

    res.status(201).json(friendship);
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
    if (!friendship) throw new AppError(404, "Friend request not found");
    if (friendship.addresseeId !== user.id)
      throw new AppError(403, "Only the recipient can accept a friend request");
    if (friendship.status !== "pending")
      throw new AppError(400, "Friend request is not pending");

    const notifyRequester = await wantsInAppNotification(
      friendship.requesterId,
      "friendRequestInApp",
    );

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.friendship.update({
        where: { id },
        data: { status: "accepted" },
      });
      // Purge this user's own friend_request notification, mirroring decline
      // (PRIV-003) — otherwise a stale actionable notification survives the
      // accept and later 400s from the Notifications panel.
      await tx.notification.deleteMany({
        where: {
          userId: user.id,
          type: "friend_request",
          payload: { path: ["friendshipId"], equals: id },
        },
      });
      if (notifyRequester) {
        // Reference IDs only — username is resolved at read time (PRIV-005).
        await tx.notification.create({
          data: {
            userId: friendship.requesterId,
            type: "friend_request_accepted",
            payload: {
              friendshipId: id,
              acceptedById: user.id,
            },
          },
        });
      }
      return u;
    });
    if (notifyRequester) {
      // Best-effort push after commit; generic title + opaque IDs only.
      void sendPushToUser(friendship.requesterId, {
        type: "friend_request_accepted",
        friendshipId: id,
      });
    }

    res.json(updated);
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
    if (!friendship) throw new AppError(404, "Friend request not found");
    if (friendship.addresseeId !== user.id)
      throw new AppError(
        403,
        "Only the recipient can decline a friend request",
      );
    if (friendship.status !== "pending")
      throw new AppError(400, "Friend request is not pending");

    // Delete the friendship and purge this user's own friend_request
    // notification that referenced it (PRIV-003 — clean the row, don't rely on
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
    if (!friendship) throw new AppError(404, "Friendship not found");
    if (friendship.status !== "accepted")
      throw new AppError(400, "No accepted friendship found");

    // Either party can remove a friend
    const isMember =
      friendship.requesterId === user.id || friendship.addresseeId === user.id;
    if (!isMember) throw new AppError(403, "Access denied");

    // Remove the friendship and any canyon shares between the two users
    const otherId =
      friendship.requesterId === user.id
        ? friendship.addresseeId
        : friendship.requesterId;

    // Collect the shares being revoked BEFORE deleting them, so we can also
    // purge each recipient's canyon_shared notification for the now-unshared
    // canyon (PRIV-001). Unfriend revokes shares in both directions, so the
    // notification purge targets both users' recipient rows.
    const revokedShares = await prisma.canyonShare.findMany({
      where: {
        OR: [
          { sharedById: user.id, sharedWithId: otherId },
          { sharedById: otherId, sharedWithId: user.id },
        ],
      },
      select: { id: true, canyonId: true, sharedById: true, sharedWithId: true },
    });

    // Canyon-level media ids of every canyon whose share is being revoked —
    // each sharee's mirror must forget the canyon AND its media (sync
    // tombstone fan-out, written in the same transaction below).
    const revokedCanyonIds = revokedShares.map((s) => s.canyonId);
    const revokedCanyonMedia =
      revokedCanyonIds.length > 0
        ? await prisma.media.findMany({
            where: { linkedType: "canyon", linkedId: { in: revokedCanyonIds } },
            select: { id: true, linkedId: true },
          })
        : [];
    const mediaIdsByCanyon = new Map<string, string[]>();
    for (const m of revokedCanyonMedia) {
      const list = mediaIdsByCanyon.get(m.linkedId) ?? [];
      list.push(m.id);
      mediaIdsByCanyon.set(m.linkedId, list);
    }
    // A linked route rides with the shared canyon record, so unfriending
    // revokes it too.
    const revokedRoutes =
      revokedCanyonIds.length > 0
        ? await prisma.route.findMany({
            where: { canyonId: { in: revokedCanyonIds } },
            select: { id: true, canyonId: true },
          })
        : [];
    const routeIdByCanyon = new Map(
      revokedRoutes.map((route) => [route.canyonId!, route.id]),
    );
    const unfriendTombstones = [
      ...friendshipDeleteTombstones({
        friendshipId: id,
        userIds: [friendship.requesterId, friendship.addresseeId],
      }),
      ...revokedShares.flatMap((s) =>
        shareRevokeTombstones({
          canyonOwnerId: s.sharedById,
          shareeId: s.sharedWithId,
          shareId: s.id,
          canyonId: s.canyonId,
          canyonMediaIds: mediaIdsByCanyon.get(s.canyonId) ?? [],
          routeId: routeIdByCanyon.get(s.canyonId) ?? null,
        }),
      ),
    ];

    await prisma.$transaction([
      prisma.syncTombstone.createMany({ data: unfriendTombstones }),
      // Revoke any canyons shared between these two users
      prisma.canyonShare.deleteMany({
        where: {
          OR: [
            { sharedById: user.id, sharedWithId: otherId },
            { sharedById: otherId, sharedWithId: user.id },
          ],
        },
      }),
      // Drop the recipient's residual canyon_shared notifications for each
      // canyon whose share was just revoked.
      ...revokedShares.map((s) =>
        prisma.notification.deleteMany({
          where: {
            userId: s.sharedWithId,
            type: "canyon_shared",
            payload: { path: ["canyonId"], equals: s.canyonId },
          },
        }),
      ),
      // Purge the friend_request / friend_request_accepted notifications that
      // referenced this friendship on either party's side.
      prisma.notification.deleteMany({
        where: {
          type: { in: ["friend_request", "friend_request_accepted"] },
          payload: { path: ["friendshipId"], equals: id },
        },
      }),
      prisma.friendship.delete({ where: { id } }),
    ]);

    res.status(204).send();
  },
);

// ── Sharing audit (fix 24) ────────────────────────────────────
//
// "What does Bob see, and how do I take it all back?" Sharing is authored
// per-canyon, so the per-person view had no surface; these two routes are it.
//
// `:id` is a FRIENDSHIP id, matching every other `/friends/:id/*` route
// (accept / decline / DELETE). That is also the authorization anchor: shares
// only ever exist between friends (POST /canyons/:id/share enforces it), so
// resolving the friendship and asserting membership is the whole check.
//
// ACCESS DECISION — why these do NOT call lib/canyonAccess.ts:
// those helpers answer "what is my role on THIS canyon" and exist to vet an
// arbitrary caller-supplied canyon id. These routes accept no canyon id: the
// set is derived from the caller's own ownership via `canyon: { ownerId }`,
// so a canyon the caller can't see is simply absent and there is no id to
// vet. Same pattern (and same rationale) as GET /canyons/tracks and GET
// /canyons. Filtering on the canyon's `ownerId` rather than the share's
// `sharedById` is deliberate: it derives from ownership directly instead of
// trusting that `sharedById` still equals the owner.
//
// EMAIL: these responses join no User rows at all — the friend's identity is
// already known from the friendship, and canyon rows carry no user fields. The
// username-only rule for /friends is therefore structural here, not a `select`
// that could drift (see the `select` below: id/name/createdAt only).

/**
 * Canyons I OWN that are shared with `friendId`. Deriving the set from the
 * canyon's `ownerId` (not the share's `sharedById`) is what makes it
 * impossible to list or revoke a share on a canyon the caller doesn't own.
 */
export function ownedSharesToFriendWhere(userId: string, friendId: string) {
  return { sharedWithId: friendId, canyon: { ownerId: userId } };
}

/** Canyons `friendId` owns that are shared with me. The mirror image. */
export function receivedSharesFromFriendWhere(userId: string, friendId: string) {
  return { sharedWithId: userId, canyon: { ownerId: friendId } };
}

// Resolve a friendship the caller is a member of, and return the other party's
// id. 403 (not 404) for a non-member mirrors DELETE /friends/:id and
// /:id/accept — the anti-oracle 404 rule is scoped to canyon ids, and no canyon
// id is accepted here.
export async function resolveFriendCounterpart(
  friendshipId: string,
  userId: string,
): Promise<string> {
  const friendship = await prisma.friendship.findUnique({
    where: { id: friendshipId },
  });
  if (!friendship) throw new AppError(404, "Friendship not found");
  if (friendship.status !== "accepted")
    throw new AppError(400, "No accepted friendship found");
  const isMember =
    friendship.requesterId === userId || friendship.addresseeId === userId;
  if (!isMember) throw new AppError(403, "Access denied");
  return friendship.requesterId === userId
    ? friendship.addresseeId
    : friendship.requesterId;
}

// ── GET /friends/:id/shares ───────────────────────────────────
// Both directions of the sharing relationship with one friend, in one trip.
router.get(
  "/:id/shares",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const friendId = await resolveFriendCounterpart(
      getParam(req.params.id),
      user.id,
    );

    // Minimal projection: no coords, no notes — an audit list needs a label.
    const select = {
      id: true,
      canyon: { select: { id: true, name: true } },
      createdAt: true,
    };

    const [theirs, mine] = await Promise.all([
      // Canyons I own that this friend can see.
      prisma.canyonShare.findMany({
        where: ownedSharesToFriendWhere(user.id, friendId),
        select,
        orderBy: { createdAt: "desc" },
      }),
      // Canyons this friend owns that I can see.
      prisma.canyonShare.findMany({
        where: receivedSharesFromFriendWhere(user.id, friendId),
        select,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const shape = (rows: typeof theirs) =>
      rows.map((r) => ({
        canyonId: r.canyon.id,
        name: r.canyon.name,
        sharedAt: r.createdAt,
      }));

    res.json({ sharedWithThem: shape(theirs), sharedWithYou: shape(mine) });
  },
);

// ── DELETE /friends/:id/shares ────────────────────────────────
// "Unshare all" — revoke every canyon I OWN that is shared with this friend.
// One direction only, by design: it never touches what the friend shares with
// me (that is their grant to withdraw, or mine to drop one row at a time via
// DELETE /canyons/:id/share/me). The friendship itself survives — that is the
// difference from DELETE /friends/:id, which revokes both directions and is
// the existing bulk lever if you want the person gone entirely.
router.delete(
  "/:id/shares",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const friendId = await resolveFriendCounterpart(
      getParam(req.params.id),
      user.id,
    );

    // Collect before deleting so each revoked canyon's residual
    // canyon_shared notification can be purged too (PRIV-001), exactly as
    // DELETE /friends/:id does.
    const revoked = await prisma.canyonShare.findMany({
      where: ownedSharesToFriendWhere(user.id, friendId),
      select: { id: true, canyonId: true },
    });

    if (revoked.length > 0) {
      // The friend's mirror must forget each canyon + its canyon-level media;
      // the owner's mirror forgets the share rows (sync tombstones, same
      // transaction as the revoke).
      const canyonMedia = await prisma.media.findMany({
        where: {
          linkedType: "canyon",
          linkedId: { in: revoked.map((r) => r.canyonId) },
        },
        select: { id: true, linkedId: true },
      });
      const mediaIdsByCanyon = new Map<string, string[]>();
      for (const m of canyonMedia) {
        const list = mediaIdsByCanyon.get(m.linkedId) ?? [];
        list.push(m.id);
        mediaIdsByCanyon.set(m.linkedId, list);
      }
      // A linked route rides with the shared canyon record.
      const revokedRoutes = await prisma.route.findMany({
        where: { canyonId: { in: revoked.map((r) => r.canyonId) } },
        select: { id: true, canyonId: true },
      });
      const routeIdByCanyon = new Map(
        revokedRoutes.map((route) => [route.canyonId!, route.id]),
      );
      await prisma.$transaction([
        prisma.syncTombstone.createMany({
          data: revoked.flatMap((r) =>
            shareRevokeTombstones({
              canyonOwnerId: user.id,
              shareeId: friendId,
              shareId: r.id,
              canyonId: r.canyonId,
              canyonMediaIds: mediaIdsByCanyon.get(r.canyonId) ?? [],
              routeId: routeIdByCanyon.get(r.canyonId) ?? null,
            }),
          ),
        }),
        prisma.canyonShare.deleteMany({
          where: { id: { in: revoked.map((r) => r.id) } },
        }),
        ...revoked.map((r) =>
          prisma.notification.deleteMany({
            where: {
              userId: friendId,
              type: "canyon_shared",
              payload: { path: ["canyonId"], equals: r.canyonId },
            },
          }),
        ),
      ]);
    }

    // Count only — never the canyon names/coords that were revoked (PRIV-005).
    logger.info(
      { userId: user.id, revokedCount: revoked.length },
      "shares_bulk_revoked",
    );

    res.json({ revokedCount: revoked.length });
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
      throw new AppError(400, "Search query must be at least 3 characters");
    }

    const users = await prisma.user.findMany({
      where: {
        username: { contains: q, mode: "insensitive" },
        id: { not: user.id },
      },
      select: { id: true, username: true },
      take: 10,
    });

    res.json(users);
  },
);

export default router;
