import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError, malformed } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { say, normalizeUserUiPreferences } from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";
import { sendPushToUser } from "../services/push";
import { getPlaceRole, requirePlaceOwnerAccess } from "../lib/placeAccess";
import { shareRevokeTombstones, writeTombstones } from "../lib/syncTombstones";

const router = Router();

// ── POST /places/:id/share ───────────────────────────────────
// Share a place with a friend
router.post(
  "/:id/share",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const placeId = getParam(req.params.id);
    const place = await prisma.place.findUnique({ where: { id: placeId } });
    if (!place) throw new AppError(404, say`Couldn't find that place.`);
    await requirePlaceOwnerAccess(
      user.id,
      place,
      say`Only the owner can share this place.`,
    );

    const { sharedWithUserId } = req.body;
    if (!sharedWithUserId) throw malformed("sharedWithUserId is required");

    // Friendship first, target-user lookup second: looking the user up first
    // would answer 404 for an unknown id and 403 for a non-friend, an oracle
    // for which user ids exist. An accepted friendship implies the row
    // exists, so this order gives both the same 403 (sharing.test.ts,
    // "unknown user id").
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
      throw new AppError(403, say`You can only share with friends.`);

    // Unreachable given the friendship above; kept so a missing row fails loud
    // rather than reading preferences off undefined.
    const targetUser = await prisma.user.findUnique({
      where: { id: sharedWithUserId },
    });
    if (!targetUser) throw new AppError(404, say`Couldn't find that person.`);

    // Prevent duplicate shares
    const existing = await prisma.placeShare.findFirst({
      where: { placeId, sharedWithId: sharedWithUserId },
    });
    if (existing)
      throw new AppError(409, say`You've already shared this place with them.`);

    const notifyRecipient = normalizeUserUiPreferences(targetUser.uiPreferences)
      .notifications.shareInApp;

    // Create the share and (optionally) notification in a transaction
    const share = await prisma.$transaction(async (tx) => {
      const created = await tx.placeShare
        .create({
          data: {
            placeId,
            sharedById: user.id,
            sharedWithId: sharedWithUserId,
          },
        })
        .catch((err: unknown) => {
          // A concurrent grant of the same pair won the race past the
          // pre-check; the unique key stopped this one.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          )
            throw new AppError(
              409,
              say`You've already shared this place with them.`,
            );
          throw err;
        });
      // The delta's shared-place visibility is a WHERE-restriction layered on
      // `updatedAt > since`, so GRANTING visibility moves no watermark and the
      // place is simply not in the recipient's next page. A sharee who had
      // ever synced before received the share row pointing at a place they
      // never got — until the owner happened to edit it. Only a first-ever
      // pull (since = epoch) was unaffected, which is why it went unnoticed.
      await tx.place.update({
        where: { id: placeId },
        data: { updatedAt: new Date() },
      });
      if (notifyRecipient) {
        // Store only reference IDs — never denormalise plaintext place names
        // or usernames into the payload (PRIV-005). Display strings are resolved
        // from the live place/user rows at read time in notifications.ts. This
        // is what makes revoked/deleted shares stop surfacing a name at all
        // (PRIV-001/003): if the reference is gone there is nothing to resolve.
        await tx.notification.create({
          data: {
            userId: sharedWithUserId,
            type: "place_shared",
            payload: {
              placeId,
              sharedById: user.id,
            },
          },
        });
      }
      return created;
    });
    if (notifyRecipient) {
      // Best-effort push after commit; generic title + opaque IDs only
      // (privacy rule — the place name is NEVER in a push payload).
      void sendPushToUser(sharedWithUserId, { type: "place_shared", placeId });
    }

    res.status(201).json(share);
  },
);

// ── DELETE /places/:id/share/:userId ─────────────────────────
// Revoke a share — can be called by the sharer or the sharee
router.delete(
  "/:id/share/:userId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const placeId = getParam(req.params.id);
    const rawUserId = getParam(req.params.userId);
    const targetUserId = rawUserId === "me" ? user.id : rawUserId;

    // Authorize BEFORE any share lookup so the response can't become an
    // existence oracle for a (placeId, targetUserId) share pair (SEC-001).
    // Revoke is permitted for the place owner (sharer) or the named sharee
    // removing their own share. A caller who is neither gets 404 — identical
    // to the no-place / no-share path — so a third party cannot distinguish
    // "place X is shared with user Y" from "it is not". The owner decision
    // derives from placeAccess (getPlaceRole), never an inline owner check.
    const place = await prisma.place.findUnique({ where: { id: placeId } });
    if (!place) throw new AppError(404, say`Couldn't find that place.`);

    const isSharer = (await getPlaceRole(user.id, place)) === "owner";
    const isSharee = targetUserId === user.id;
    if (!isSharer && !isSharee)
      throw new AppError(404, say`Couldn't find that place.`);

    // Every row, not one: the duplicate check on grant is not atomic and the
    // table has no unique key, so a raced pair can exist, and any survivor
    // would keep the sharee's access.
    const shares = await prisma.placeShare.findMany({
      where: { placeId, sharedWithId: targetUserId },
      select: { id: true },
    });
    if (shares.length === 0)
      throw new AppError(404, say`This isn't shared with them any more.`);

    // Revoke the share AND remove the recipient's place_shared notification
    // for this place in one transaction (PRIV-001). The read-time filter would
    // already hide the name, but revocation should purge the recipient's
    // residual row, not leave it at rest. Sync tombstones ride the same
    // transaction: the sharee must forget the place record + its place-level
    // media, the owner the share row (see lib/syncTombstones.ts).
    await prisma.$transaction(async (tx) => {
      const placeMedia = await tx.media.findMany({
        where: { linkedType: "place", linkedId: placeId },
        select: { id: true },
      });
      // A linked route is part of the shared place record, so the sharee
      // loses it alongside the place-level media.
      const linkedRoute = await tx.route.findUnique({
        where: { placeId },
        select: { id: true },
      });
      // Places LINKED to this one do NOT go: a PlaceLink grants no visibility,
      // so the recipient never had them through this share and there is
      // nothing to revoke. (A route does, through Route.placeId — a foreign
      // key, not a link. The distinction is lib/shareAccess.ts's.)
      await tx.placeShare.deleteMany({
        where: { placeId, sharedWithId: targetUserId },
      });
      await tx.notification.deleteMany({
        where: {
          userId: targetUserId,
          type: "place_shared",
          payload: { path: ["placeId"], equals: placeId },
        },
      });
      await writeTombstones(
        tx,
        shareRevokeTombstones({
          placeOwnerId: place.ownerId,
          shareeId: targetUserId,
          shareId: shares[0].id,
          placeId,
          placeMediaIds: placeMedia.map((m) => m.id),
          routeId: linkedRoute?.id ?? null,
        }).concat(
          shares.slice(1).map((extra) => ({
            userId: place.ownerId,
            entityType: "placeShare" as const,
            entityId: extra.id,
          })),
        ),
      );
    });

    res.status(204).send();
  },
);

// ── GET /places/:id/shares ───────────────────────────────────
// List all users a place has been shared with (owner only)
router.get(
  "/:id/shares",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const placeId = getParam(req.params.id);
    const place = await prisma.place.findUnique({ where: { id: placeId } });
    if (!place) throw new AppError(404, say`Couldn't find that place.`);
    await requirePlaceOwnerAccess(
      user.id,
      place,
      say`Only the owner can see who this is shared with.`,
    );

    const shares = await prisma.placeShare.findMany({
      where: { placeId },
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
