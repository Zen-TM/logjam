import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { friendsSearchLimiter } from "../middleware/rateLimit";

const router = Router();

function getParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

// ── GET /friends ──────────────────────────────────────────────
// Returns all accepted friends for the current user
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

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
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

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
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

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

    // Create friendship record and notification in a transaction
    const [friendship] = await prisma.$transaction([
      prisma.friendship.create({
        data: {
          requesterId: user.id,
          addresseeId,
          status: "pending",
        },
      }),
      prisma.notification.create({
        data: {
          userId: addresseeId,
          type: "friend_request",
          payload: {
            friendshipId: "", // updated below
            requesterId: user.id,
            requesterUsername: user.username,
          },
        },
      }),
    ]);

    // Update notification payload with the friendship ID
    await prisma.notification.updateMany({
      where: {
        userId: addresseeId,
        type: "friend_request",
        payload: { path: ["requesterId"], equals: user.id },
      },
      data: {
        payload: {
          friendshipId: friendship.id,
          requesterId: user.id,
          requesterUsername: user.username,
        },
      },
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
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const id = getParam(req.params.id);
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship) throw new AppError(404, "Friend request not found");
    if (friendship.addresseeId !== user.id)
      throw new AppError(403, "Only the recipient can accept a friend request");
    if (friendship.status !== "pending")
      throw new AppError(400, "Friend request is not pending");

    const [updated] = await prisma.$transaction([
      prisma.friendship.update({
        where: { id },
        data: { status: "accepted" },
      }),
      // Notify the requester their request was accepted
      prisma.notification.create({
        data: {
          userId: friendship.requesterId,
          type: "friend_request_accepted",
          payload: {
            friendshipId: id,
            acceptedById: user.id,
            acceptedByUsername: user.username,
          },
        },
      }),
    ]);

    res.json(updated);
  },
);

// ── PATCH /friends/:id/decline ────────────────────────────────
// Decline a pending friend request
router.patch(
  "/:id/decline",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

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

    await prisma.friendship.delete({ where: { id } });

    res.status(204).send();
  },
);

// ── DELETE /friends/:id ───────────────────────────────────────
// Remove an existing friend
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

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
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

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
