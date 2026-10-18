// Plan invite links: a leader mints one and posts it to the group; whoever
// opens it, signed in, may ask to join, and a leader lets each one in.
//
// The friend invite's token design, reused whole (routes/friendInvites.ts):
// 256 random bits in the URL fragment, only the hash stored, the token only
// ever in the body of an authenticated POST. Unlike a friend link it is
// MULTI-USE until it expires or a leader revokes it, because it grants a
// request and not a membership: one link posted to the group is the point.
//
// WHAT A HELD LINK SHOWS, since links get forwarded: the plan's name, dates,
// the leader a request waits for and the forms required to join. Never who
// is going or the write-up, until a leader approves.
//
// Every way a token can fail (malformed, unknown, expired, revoked, its plan
// deleted or archived, a block with a leader) gives the same 404.
// Guard: __tests__/planInvites.test.ts.
import { Router, Response } from "express";
import {
  isFriendInviteToken,
  say,
  TRIP_PLAN_INVITE_TTL_DAYS,
  type TripPlanLinkPreview,
  type TripPlanRedeemResult,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  planInviteCreateLimiter,
  planInviteRedeemLimiter,
} from "../middleware/rateLimit";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  hashFriendInviteToken,
  mintFriendInviteToken,
} from "../lib/friendInviteToken";
import {
  requirePlanMember,
  requirePlanRole,
  requirePlanWrite,
  touchPlan,
} from "../lib/planAccess";
import { dateOnly } from "../lib/tripPlanView";
import {
  activeMemberIds,
  joinForms,
  notifyPlan,
  saveJoinAnswers,
  waitingFor,
} from "../lib/planMembership";
import { isUniqueViolation } from "./friends";
import { joinInvited } from "./planMembers";

const TTL_MS = TRIP_PLAN_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

const ONLY_LEADERS = say`Only a leader can make an invite link.`;
/** A leader invited the caller by username while they used a link. */
const RACED = say`Someone in this plan just invited you. Open the plan from your list.`;

// ── /plans/:planId/invites: a leader's links ──────────────────

export const planInviteLinksRouter = Router({ mergeParams: true });

// ── POST /plans/:planId/invites ───────────────────────────────
// Mint a link. The token is in this response and nowhere else, ever.
planInviteLinksRouter.post(
  "/",
  requireAuth,
  planInviteCreateLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanWrite(user.id, getParam(req.params.planId));
    requirePlanRole(access, ["leader"], ONLY_LEADERS);
    const planId = access.plan.id;
    const token = mintFriendInviteToken();
    const expiresAt = new Date(Date.now() + TTL_MS);
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      // The only sweep there is: a plan's expired links go when a leader
      // next mints one.
      await tx.tripPlanInvite.deleteMany({
        where: { planId, expiresAt: { lte: new Date() } },
      });
      await tx.tripPlanInvite.create({
        data: {
          planId,
          createdById: user.id,
          tokenHash: hashFriendInviteToken(token),
          expiresAt,
        },
      });
    });
    res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
  },
);

// ── GET /plans/:planId/invites ────────────────────────────────
// The plan's working links: when each ends, never the link itself.
planInviteLinksRouter.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanMember(
      user.id,
      getParam(req.params.planId),
    );
    requirePlanRole(access, ["leader"], ONLY_LEADERS);
    const invites = await prisma.tripPlanInvite.findMany({
      where: { planId: access.plan.id, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        createdBy: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      invites: invites.map((invite) => ({
        ...invite,
        createdAt: invite.createdAt.toISOString(),
        expiresAt: invite.expiresAt.toISOString(),
      })),
    });
  },
);

// ── DELETE /plans/:planId/invites/:inviteId ───────────────────
// Revoke one link. Requests it already brought stay for a leader to answer.
planInviteLinksRouter.delete(
  "/:inviteId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanMember(
      user.id,
      getParam(req.params.planId),
    );
    requirePlanRole(access, ["leader"], ONLY_LEADERS);
    const planId = access.plan.id;
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const { count } = await tx.tripPlanInvite.deleteMany({
        where: { id: getParam(req.params.inviteId), planId },
      });
      if (count === 0) throw new AppError(404, say`Couldn't find that.`);
    });
    res.status(204).send();
  },
);

// ── /plan-invites: whoever holds a link ───────────────────────

const router = Router();

function invalidLink(): AppError {
  return new AppError(404, say`This invite link no longer works.`);
}

/** The live link a token names, its plan, and the caller's place in it. */
async function resolveLink(token: unknown, callerId: string) {
  if (!isFriendInviteToken(token)) throw invalidLink();
  const invite = await prisma.tripPlanInvite.findUnique({
    where: { tokenHash: hashFriendInviteToken(token) },
    select: {
      expiresAt: true,
      createdById: true,
      plan: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          archivedAt: true,
          members: {
            where: { userId: callerId },
            select: { status: true },
          },
        },
      },
    },
  });
  if (!invite || invite.expiresAt <= new Date() || invite.plan.archivedAt)
    throw invalidLink();
  const plan = invite.plan;
  const leader = await waitingFor(prisma, plan.id, invite.createdById);
  if (!leader) throw invalidLink();
  // A block with any leader is not something a link overrides, or reveals.
  const leaders = await activeMemberIds(prisma, plan.id, [], "leader");
  const blocked = await prisma.friendship.count({
    where: {
      status: "blocked",
      OR: [
        { requesterId: callerId, addresseeId: { in: leaders } },
        { requesterId: { in: leaders }, addresseeId: callerId },
      ],
    },
  });
  if (blocked > 0) throw invalidLink();
  return {
    plan,
    leader,
    createdById: invite.createdById,
    membership: plan.members[0]?.status ?? null,
  };
}

// ── POST /plan-invites/preview ────────────────────────────────
// Body { token }. What the join dialog shows before anyone asks.
router.post(
  "/preview",
  requireAuth,
  planInviteRedeemLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const link = await resolveLink(req.body?.token, user.id);
    const preview: TripPlanLinkPreview = {
      planId: link.plan.id,
      name: link.plan.name,
      startDate: dateOnly(link.plan.startDate),
      endDate: dateOnly(link.plan.endDate),
      leader: link.leader,
      requiredForms: await joinForms(prisma, link.plan.id),
      membership: link.membership as TripPlanLinkPreview["membership"],
    };
    res.json(preview);
  },
);

/** One attempt at asking to join. Throws P2002 when the caller's own other
 *  request, or a leader's invite, gives them a row first. */
async function request(
  planId: string,
  userId: string,
  invitedById: string | null,
  answers: unknown,
): Promise<void> {
  const push = await prisma.$transaction(async (tx) => {
    await touchPlan(tx, planId);
    const existing = await tx.tripPlanMember.findUnique({
      where: { planId_userId: { planId, userId } },
      select: { status: true },
    });
    // Asked already: the new answers replace the old, and the leaders are
    // not told twice.
    if (existing?.status === "requested") {
      await saveJoinAnswers(tx, planId, userId, answers);
      return () => {};
    }
    if (existing) throw new AppError(409, RACED);
    await tx.tripPlanMember.create({
      data: {
        planId,
        userId,
        role: "member",
        status: "requested",
        invitedById,
      },
    });
    await saveJoinAnswers(tx, planId, userId, answers);
    // One notification per leader, with ids only. The answers are read in
    // the plan, where a leader sees a request's answers.
    return notifyPlan(tx, await activeMemberIds(tx, planId, [], "leader"), {
      type: "plan_join_request",
      payload: { planId, requesterId: userId },
    });
  });
  push();
}

// ── POST /plan-invites/redeem ─────────────────────────────────
// Body { token, answers: TripPlanJoinAnswers }. Asks to join (201, waiting
// for a leader); someone a leader already invited by username joins at once,
// and someone already in is told so (200).
router.post(
  "/redeem",
  requireAuth,
  planInviteRedeemLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const link = await resolveLink(req.body?.token, user.id);
    const planId = link.plan.id;
    const answers = req.body?.answers;
    if (link.membership === "invited")
      await joinInvited(planId, user.id, answers);
    if (link.membership === "invited" || link.membership === "active") {
      const result: TripPlanRedeemResult = { planId, status: "active" };
      res.json(result);
      return;
    }
    await request(planId, user.id, link.createdById, answers).catch(
      (err: unknown) => {
        throw isUniqueViolation(err) ? new AppError(409, RACED) : err;
      },
    );
    const result: TripPlanRedeemResult = {
      planId,
      status: "requested",
      waitingFor: link.leader,
    };
    res.status(201).json(result);
  },
);

export default router;
