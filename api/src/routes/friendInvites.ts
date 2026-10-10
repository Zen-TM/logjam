// Friend invite links: befriending without the username search.
//
// The inviter mints a link and sends it however they like; whoever opens it,
// SIGNED IN, becomes their friend. Sharing the link is the inviter's consent,
// which is why spending it creates a friendship and not a request.
//
// WHAT THE LINK IS WORTH, and so what a leaked one gives away: a friendship
// with the inviter, once, within FRIEND_INVITE_TTL_DAYS. A friendship shows
// nothing by itself (sharing stays per place, ADR 0002); it puts the holder in
// the inviter's share picker and lets them send the inviter copies. The
// inviter is told who joined and can remove them.
//
// Nothing here answers a signed-out request: the link opens Logjam Web, whose
// sign-in screen is static, and the token only ever travels in the body of an
// authenticated POST (never a path or query, which reach access logs).
//
// Every way a token can fail gives the same 404, so a response cannot tell a
// spent link from one that never existed. Guard: __tests__/friendInvites.test.ts.
import { Router, Response } from "express";
import { FRIEND_INVITE_TTL_DAYS, isFriendInviteToken } from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  friendInviteCreateLimiter,
  friendInviteRedeemLimiter,
} from "../middleware/rateLimit";
import { resolveUser } from "../lib/resolveUser";
import { sendPushToUser } from "../services/push";
import {
  hashFriendInviteToken,
  mintFriendInviteToken,
} from "../lib/friendInviteToken";
import { wantsInAppNotification } from "./friends";

const router = Router();

const TTL_MS = FRIEND_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

function invalidLink(): AppError {
  return new AppError(404, "This invite link is no longer valid");
}

/** The live invite a token names, for a caller who is not its inviter. */
async function resolveInvite(token: unknown, callerId: string) {
  if (!isFriendInviteToken(token)) throw invalidLink();
  const invite = await prisma.friendInvite.findUnique({
    where: { tokenHash: hashFriendInviteToken(token) },
    select: {
      id: true,
      expiresAt: true,
      inviter: { select: { id: true, username: true } },
    },
  });
  if (!invite || invite.expiresAt <= new Date()) throw invalidLink();
  // The caller's own link tells them nothing they do not know.
  if (invite.inviter.id === callerId)
    throw new AppError(400, "This is your own invite link");
  const friendship = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: callerId, addresseeId: invite.inviter.id },
        { requesterId: invite.inviter.id, addresseeId: callerId },
      ],
    },
  });
  // A block is not something a link overrides, or reveals.
  if (friendship?.status === "blocked") throw invalidLink();
  return { invite, friendship };
}

// ── POST /friends/invites ─────────────────────────────────────
// Mint a link. The token is in this response and nowhere else, ever.
router.post(
  "/",
  requireAuth,
  friendInviteCreateLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const token = mintFriendInviteToken();
    const expiresAt = new Date(Date.now() + TTL_MS);
    await prisma.$transaction([
      // The only sweep there is: expired rows go when their owner next mints.
      prisma.friendInvite.deleteMany({
        where: { inviterId: user.id, expiresAt: { lte: new Date() } },
      }),
      prisma.friendInvite.create({
        data: {
          inviterId: user.id,
          tokenHash: hashFriendInviteToken(token),
          expiresAt,
        },
      }),
    ]);
    res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
  },
);

// ── GET /friends/invites ──────────────────────────────────────
// The caller's unspent links: when each ends, never the link itself.
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const invites = await prisma.friendInvite.findMany({
      where: { inviterId: user.id, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(invites);
  },
);

// ── DELETE /friends/invites ───────────────────────────────────
// Revoke every link the caller has out. All of them, because the caller
// cannot tell them apart: the links themselves are not kept.
router.delete(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    await prisma.friendInvite.deleteMany({ where: { inviterId: user.id } });
    res.status(204).send();
  },
);

// ── POST /friends/invites/preview ─────────────────────────────
// Who a link is from, so the opener agrees to a name and not to a URL.
// Username only, to a signed-in caller: what /friends/search already gives.
router.post(
  "/preview",
  requireAuth,
  friendInviteRedeemLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const { invite, friendship } = await resolveInvite(
      req.body?.token,
      user.id,
    );
    res.json({
      inviter: { username: invite.inviter.username },
      alreadyFriends: friendship?.status === "accepted",
    });
  },
);

// ── POST /friends/invites/redeem ──────────────────────────────
// Spend a link: the caller and its inviter are friends from here.
router.post(
  "/redeem",
  requireAuth,
  friendInviteRedeemLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const { invite, friendship } = await resolveInvite(
      req.body?.token,
      user.id,
    );
    const inviter = invite.inviter;

    // Already friends: nothing to do, and the link is left for whoever it was
    // really meant for.
    if (friendship?.status === "accepted") {
      res.json({ ...inviter, friendshipId: friendship.id });
      return;
    }

    const notifyInviter = await wantsInAppNotification(
      inviter.id,
      "friendRequestInApp",
    );

    const friendshipId = await prisma.$transaction(async (tx) => {
      // The delete IS the spend: of two openers racing, one deletes a row and
      // the other deletes none.
      const spent = await tx.friendInvite.deleteMany({
        where: { id: invite.id, expiresAt: { gt: new Date() } },
      });
      if (spent.count !== 1) throw invalidLink();

      let id: string;
      if (friendship) {
        // A request was already waiting between the two, either way round.
        // Both have now said yes, so it is accepted and its prompt goes.
        id = friendship.id;
        await tx.friendship.update({
          where: { id },
          data: { status: "accepted" },
        });
        await tx.notification.deleteMany({
          where: {
            type: "friend_request",
            payload: { path: ["friendshipId"], equals: id },
          },
        });
      } else {
        const created = await tx.friendship.create({
          data: {
            requesterId: inviter.id,
            addresseeId: user.id,
            status: "accepted",
          },
        });
        id = created.id;
      }
      if (notifyInviter) {
        // The type an accepted request writes, so every supported build of
        // Logjam GPS already draws it (ADR 0022); `viaInvite` lets a build
        // that knows it word the row for a link. Ids only; the username is
        // resolved at read time.
        await tx.notification.create({
          data: {
            userId: inviter.id,
            type: "friend_request_accepted",
            payload: {
              friendshipId: id,
              acceptedById: user.id,
              viaInvite: true,
            },
          },
        });
      }
      return id;
    });
    if (notifyInviter) {
      void sendPushToUser(inviter.id, {
        type: "friend_request_accepted",
        friendshipId,
      });
    }

    res.json({ ...inviter, friendshipId });
  },
);

export default router;
