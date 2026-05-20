import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { normalizeUserUiPreferences } from "@logjam/shared";

const router = Router();

// ── POST /canyons/:id/share ───────────────────────────────────
// Share a canyon with a friend
router.post(
  "/:id/share",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.id);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");
    if (canyon.ownerId !== user.id)
      throw new AppError(403, "Only the owner can share a canyon");

    const { sharedWithUserId } = req.body;
    if (!sharedWithUserId)
      throw new AppError(400, "sharedWithUserId is required");

    // Confirm the target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: sharedWithUserId },
    });
    if (!targetUser) throw new AppError(404, "Target user not found");

    // Confirm they are friends
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: "accepted",
        OR: [
          { requesterId: user.id, addresseeId: sharedWithUserId },
          { requesterId: sharedWithUserId, addresseeId: user.id },
        ],
      },
    });
    if (!friendship)
      throw new AppError(403, "You can only share canyons with friends");

    // Prevent duplicate shares
    const existing = await prisma.canyonShare.findFirst({
      where: { canyonId, sharedWithId: sharedWithUserId },
    });
    if (existing)
      throw new AppError(409, "Canyon already shared with this user");

    const notifyRecipient = normalizeUserUiPreferences(targetUser.uiPreferences)
      .notifications.shareInApp;

    // Create the share and (optionally) notification in a transaction
    const share = await prisma.$transaction(async (tx) => {
      const created = await tx.canyonShare.create({
        data: {
          canyonId,
          sharedById: user.id,
          sharedWithId: sharedWithUserId,
        },
      });
      if (notifyRecipient) {
        await tx.notification.create({
          data: {
            userId: sharedWithUserId,
            type: "canyon_shared",
            payload: {
              canyonId,
              canyonName: canyon.name,
              sharedById: user.id,
              sharedByUsername: user.username,
            },
          },
        });
      }
      return created;
    });

    res.status(201).json(share);
  },
);

// ── DELETE /canyons/:id/share/:userId ─────────────────────────
// Revoke a share — can be called by the sharer or the sharee
router.delete(
  "/:id/share/:userId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.id);
    const rawUserId = getParam(req.params.userId);
    const targetUserId = rawUserId === "me" ? user.id : rawUserId;

    const share = await prisma.canyonShare.findFirst({
      where: { canyonId, sharedWithId: targetUserId },
    });
    if (!share) throw new AppError(404, "Share not found");

    // Allow the sharer or the sharee to remove the share
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    const isSharer = canyon?.ownerId === user.id;
    const isSharee = targetUserId === user.id;
    if (!isSharer && !isSharee) throw new AppError(403, "Access denied");

    await prisma.canyonShare.delete({ where: { id: share.id } });

    res.status(204).send();
  },
);

// ── GET /canyons/:id/shares ───────────────────────────────────
// List all users a canyon has been shared with (owner only)
router.get(
  "/:id/shares",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.id);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");
    if (canyon.ownerId !== user.id)
      throw new AppError(403, "Only the owner can view shares");

    const shares = await prisma.canyonShare.findMany({
      where: { canyonId },
      include: {
        sharedWith: {
          select: { id: true, username: true },
        },
      },
    });

    res.json(shares);
  },
);

export default router;
