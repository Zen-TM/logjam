import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

const router = Router();

function getParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
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

    res.json(notifications);
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
