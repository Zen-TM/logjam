import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { normalizeUserUiPreferences } from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";
import { getCanyonRole, requireCanyonOwnerAccess } from "../lib/canyonAccess";

const router = Router();

// ── POST /canyons/:id/share ───────────────────────────────────
// Share a canyon with a friend
router.post(
  "/:id/share",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const canyonId = getParam(req.params.id);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");
    await requireCanyonOwnerAccess(
      user.id,
      canyon,
      "Only the owner can share a canyon",
    );

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
        // Store only reference IDs — never denormalise plaintext canyon names
        // or usernames into the payload (PRIV-005). Display strings are resolved
        // from the live canyon/user rows at read time in notifications.ts. This
        // is what makes revoked/deleted shares stop surfacing a name at all
        // (PRIV-001/003): if the reference is gone there is nothing to resolve.
        await tx.notification.create({
          data: {
            userId: sharedWithUserId,
            type: "canyon_shared",
            payload: {
              canyonId,
              sharedById: user.id,
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
    const user = await resolveUser(req.user!.sub);

    const canyonId = getParam(req.params.id);
    const rawUserId = getParam(req.params.userId);
    const targetUserId = rawUserId === "me" ? user.id : rawUserId;

    // Authorize BEFORE any share lookup so the response can't become an
    // existence oracle for a (canyonId, targetUserId) share pair (SEC-001).
    // Revoke is permitted for the canyon owner (sharer) or the named sharee
    // removing their own share. A caller who is neither gets 404 — identical
    // to the no-canyon / no-share path — so a third party cannot distinguish
    // "canyon X is shared with user Y" from "it is not". The owner decision
    // derives from canyonAccess (getCanyonRole), never an inline owner check.
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");

    const isSharer = (await getCanyonRole(user.id, canyon)) === "owner";
    const isSharee = targetUserId === user.id;
    if (!isSharer && !isSharee) throw new AppError(404, "Canyon not found");

    const share = await prisma.canyonShare.findFirst({
      where: { canyonId, sharedWithId: targetUserId },
    });
    if (!share) throw new AppError(404, "Share not found");

    // Revoke the share AND remove the recipient's canyon_shared notification
    // for this canyon in one transaction (PRIV-001). The read-time filter would
    // already hide the name, but revocation should purge the recipient's
    // residual row, not leave it at rest.
    await prisma.$transaction([
      prisma.canyonShare.delete({ where: { id: share.id } }),
      prisma.notification.deleteMany({
        where: {
          userId: targetUserId,
          type: "canyon_shared",
          payload: { path: ["canyonId"], equals: canyonId },
        },
      }),
    ]);

    res.status(204).send();
  },
);

// ── GET /canyons/:id/shares ───────────────────────────────────
// List all users a canyon has been shared with (owner only)
router.get(
  "/:id/shares",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const canyonId = getParam(req.params.id);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");
    await requireCanyonOwnerAccess(
      user.id,
      canyon,
      "Only the owner can view shares",
    );

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
