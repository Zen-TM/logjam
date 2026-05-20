import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

const router = Router();

function getParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

// Notification payload reference shape (see plan Finding 17):
//   friend_request / friend_request_accepted: payload.friendshipId
//   canyon_shared:                            payload.canyonId
//   topo_complete / topo_failed:              self-only refs (jobId)
// When the *other* user is deleted, the cascade in DELETE /users/me wipes
// their friendships, canyon shares, and canyons. The orphan notifications
// remain on this side — filter them out at read time.
function payloadString(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

// ── GET /notifications ────────────────────────────────────────
// Returns all notifications for the current user, unread first
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: [
        { read: "asc" }, // unread first
        { createdAt: "desc" }, // newest first within each group
      ],
    });

    const friendshipIds = new Set<string>();
    const canyonIds = new Set<string>();
    for (const n of notifications) {
      if (n.type === "friend_request" || n.type === "friend_request_accepted") {
        const id = payloadString(n.payload, "friendshipId");
        if (id) friendshipIds.add(id);
      } else if (n.type === "canyon_shared") {
        const id = payloadString(n.payload, "canyonId");
        if (id) canyonIds.add(id);
      }
    }

    const [existingFriendships, existingCanyons] = await Promise.all([
      friendshipIds.size > 0
        ? prisma.friendship.findMany({
            where: { id: { in: [...friendshipIds] } },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
      canyonIds.size > 0
        ? prisma.canyon.findMany({
            where: { id: { in: [...canyonIds] } },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
    ]);

    const liveFriendships = new Set(existingFriendships.map((f) => f.id));
    const liveCanyons = new Set(existingCanyons.map((c) => c.id));

    const visible = notifications.filter((n) => {
      if (n.type === "friend_request" || n.type === "friend_request_accepted") {
        const id = payloadString(n.payload, "friendshipId");
        return id !== null && liveFriendships.has(id);
      }
      if (n.type === "canyon_shared") {
        const id = payloadString(n.payload, "canyonId");
        return id !== null && liveCanyons.has(id);
      }
      return true;
    });

    res.json(visible);
  },
);

// ── GET /notifications/unread-count ───────────────────────────
// Returns the count of unread notifications (for badge display)
router.get(
  "/unread-count",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const count = await prisma.notification.count({
      where: { userId: user.id, read: false },
    });

    res.json({ count });
  },
);

// ── PATCH /notifications/:id/read ─────────────────────────────
// Mark a single notification as read
router.patch(
  "/:id/read",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const id = getParam(req.params.id);
    const notification = await prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) throw new AppError(404, "Notification not found");
    if (notification.userId !== user.id)
      throw new AppError(403, "Access denied");

    const updated = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    res.json(updated);
  },
);

// ── PATCH /notifications/read-all ─────────────────────────────
// Mark all notifications as read
router.patch(
  "/read-all",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });

    res.status(204).send();
  },
);

// ── DELETE /notifications/:id ─────────────────────────────────
// Delete a single notification
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const id = getParam(req.params.id);
    const notification = await prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) throw new AppError(404, "Notification not found");
    if (notification.userId !== user.id)
      throw new AppError(403, "Access denied");

    await prisma.notification.delete({ where: { id } });

    res.status(204).send();
  },
);

// ── DELETE /notifications ─────────────────────────────────────
// Clear all read notifications
router.delete(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    await prisma.notification.deleteMany({
      where: { userId: user.id, read: true },
    });

    res.status(204).send();
  },
);

export default router;
