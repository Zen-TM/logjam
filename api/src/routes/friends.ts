import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { friendsSearchLimiter } from "../middleware/rateLimit";
import { getParam } from "../lib/getParam";
import { normalizeUserUiPreferences } from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";

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
    // the read-time filter alone).
    await prisma.$transaction([
      prisma.notification.deleteMany({
        where: {
          userId: user.id,
          type: "friend_request",
          payload: { path: ["friendshipId"], equals: id },
        },
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
      select: { canyonId: true, sharedWithId: true },
    });

    await prisma.$transaction([
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
