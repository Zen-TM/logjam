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
  blockedWithAny,
  joinForms,
  notifyPlan,
  saveJoinAnswers,
  waitingFor,
} from "../lib/planMembership";
import { joinInvited } from "./planMembers";

const TTL_MS = TRIP_PLAN_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

const ONLY_LEADERS_MINT = say`Only a leader can make an invite link.`;
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
    requirePlanRole(access, ["leader"], ONLY_LEADERS_MINT);
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
    requirePlanRole(
      access,
      ["leader"],
      say`Only a leader can see invite links.`,
    );
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
    requirePlanRole(
      access,
      ["leader"],
      say`Only a leader can revoke an invite link.`,
    );
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
  const tokenHash = hashFriendInviteToken(token);
  const invite = await prisma.tripPlanInvite.findUnique({
    where: { tokenHash },
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
  if (await blockedWithAny(prisma, callerId, leaders)) throw invalidLink();
  return {
    plan,
    leader,
    tokenHash,
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

/**
 * Ask to join behind the plan row. The link is read again there: a revoke,
 * an archive, a plan delete or its maker's account delete may have landed
 * since `resolveLink`, and each is the one dead-link 404. The request is
 * stored as waiting for the leader the response names, so GET /plans says
 * the same.
 */
async function request(
  tokenHash: string,
  planId: string,
  userId: string,
  answers: unknown,
): Promise<TripPlanRedeemResult> {
  let result!: TripPlanRedeemResult;
  const push = await prisma.$transaction(async (tx) => {
    await touchPlan(tx, planId).catch((err: unknown) => {
      throw err instanceof AppError && err.statusCode === 404
        ? invalidLink()
        : err;
    });
    const invite = await tx.tripPlanInvite.findFirst({
      where: {
        tokenHash,
        planId,
        expiresAt: { gt: new Date() },
        plan: { archivedAt: null },
      },
      select: { createdById: true },
    });
    const leader = invite && (await waitingFor(tx, planId, invite.createdById));
    if (!leader) throw invalidLink();
    const existing = await tx.tripPlanMember.findUnique({
      where: { planId_userId: { planId, userId } },
      select: { status: true },
    });
    // A leader let them in since `resolveLink` read: they are in.
    if (existing?.status === "active") {
      result = { planId, status: "active" };
      return () => {};
    }
    if (existing?.status === "invited") throw new AppError(409, RACED);
    result = { planId, status: "requested", waitingFor: leader };
    // Asked already: the new answers replace the old, and the leaders are
    // not told twice.
    if (existing) {
      await tx.tripPlanMember.update({
        where: { planId_userId: { planId, userId } },
        data: { invitedById: leader.id },
      });
      await saveJoinAnswers(tx, planId, userId, answers);
      return () => {};
    }
    await tx.tripPlanMember.create({
      data: {
        planId,
        userId,
        role: "member",
        status: "requested",
        invitedById: leader.id,
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
  return result;
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
    const result = await request(link.tokenHash, planId, user.id, answers);
    res.status(result.status === "requested" ? 201 : 200).json(result);
  },
);

export default router;
