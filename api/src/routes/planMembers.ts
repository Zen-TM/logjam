// Who is in a plan: username invites, the invited preview, joining, roles,
// approving a request, and the one DELETE for leaving and removing.
//
// Members need not be friends: a leader's invite or approval is the only
// gate. Someone invited by username was chosen by a leader, so before joining
// they see the write-up and who is going; someone who used a link sees
// neither until a leader lets them in (routes/planInvites.ts). Joining asks
// no questions asked. Leaving takes a person's answers with them;
// what they added stays in the plan.
//
// Every write starts with touchPlan (lib/planAccess.ts), so writes in one
// plan run one at a time, and behind it each reads again the rows it decides
// on: the person invited, joining, asking or leaving, and a leader's own
// role (requireStillLeader), so no two leaders acting at once can leave the
// plan without one.
// Guard: __tests__/planMembers.test.ts.
import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  isTripPlanMemberStatus,
  isTripPlanRole,
  say,
  type TripPlanInvitedPreview,
  type UserSentence,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError, malformed } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import { memberGone } from "../lib/planItems";
import {
  planArchived,
  planMembershipAnyStatus,
  planNotFound,
  requirePlanMember,
  requireStillLeader,
  requirePlanRole,
  requirePlanWrite,
  touchPlan,
} from "../lib/planAccess";
import {
  dateOnly,
  loadPlanView,
  memberInclude,
  memberView,
  sectionView,
} from "../lib/tripPlanView";
import {
  activeMemberIds,
  blockedWithAny,
  dropMembership,
  dropStalePlanNotifications,
  notifyPlan,
} from "../lib/planMembership";

const router = Router({ mergeParams: true });

const REMOVE = say`Only a leader can remove someone.`;
const NEEDS_A_LEADER = say`A plan needs a leader. Make someone else a leader first.`;

function memberNotFound(): AppError {
  return new AppError(404, say`Couldn't find that.`);
}

async function leader(req: AuthenticatedRequest, forbidden: UserSentence) {
  const user = await resolveUser(req.user!.sub);
  const access = await requirePlanWrite(user.id, getParam(req.params.planId));
  requirePlanRole(access, ["leader"], forbidden);
  return { userId: user.id, access, forbidden };
}

/** `:userId`, with `me` for the caller. */
function target(req: AuthenticatedRequest, callerId: string): string {
  const id = getParam(req.params.userId);
  return id === "me" ? callerId : id;
}

async function viewOfMember(planId: string, userId: string) {
  const row = await prisma.tripPlanMember.findUnique({
    where: { planId_userId: { planId, userId } },
    include: memberInclude,
  });
  if (!row) throw memberNotFound();
  return memberView(row);
}

// ── POST /plans/:planId/members ───────────────────────────────
// Body { username, role? }. They are invited, not in: they join when they
// accept. A block, either way, is the answer an
// unknown username gets, as in routes/friendInvites.ts.
router.post(
  "/members",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, access, forbidden } = await leader(
      req,
      say`Only a leader can invite people.`,
    );
    const planId = access.plan.id;
    const { username, role = "member" } = req.body ?? {};
    if (typeof username !== "string")
      throw malformed("username must be a string");
    if (!isTripPlanRole(role)) throw malformed("role must be a plan role");
    const noOne = new AppError(
      404,
      say`Couldn't find anyone with that username.`,
    );
    const invitee = await prisma.user.findUnique({
      where: { username: username.trim() },
      select: { id: true },
    });
    if (!invitee) throw noOne;
    if (invitee.id === userId) throw new AppError(400, say`This is you.`);
    if (await blockedWithAny(prisma, userId, [invitee.id])) throw noOne;

    const push = await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      await requireStillLeader(tx, planId, userId, forbidden);
      const existing = await tx.tripPlanMember.findUnique({
        where: { planId_userId: { planId, userId: invitee.id } },
        select: { status: true },
      });
      if (existing?.status === "active")
        throw new AppError(409, say`They're already in this plan.`);
      if (existing?.status === "invited")
        throw new AppError(409, say`They're already invited.`);
      if (existing)
        throw new AppError(
          409,
          say`They've asked to join. Let them in from the plan's members.`,
        );
      await tx.tripPlanMember.create({
        data: {
          planId,
          userId: invitee.id,
          role,
          status: "invited",
          invitedById: userId,
        },
      });
      return notifyPlan(tx, [invitee.id], {
        type: "plan_invited",
        payload: { planId, invitedById: userId },
      });
    });
    push();
    res.status(201).json(await viewOfMember(planId, invitee.id));
  },
);

// ── GET /plans/:planId/preview ────────────────────────────────
// For someone invited by username, before they join: the write-up, who is
// going. Anyone else gets 404; an active
// member reads GET /plans/:id.
router.get(
  "/preview",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const planId = getParam(req.params.planId);
    const own = await planMembershipAnyStatus(user.id, planId);
    if (own.status !== "invited") throw planNotFound();
    const plan = await prisma.tripPlan.findUnique({
      where: { id: planId },
      include: {
        sections: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
        members: {
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
          select: { user: { select: { id: true, username: true } } },
        },
      },
    });
    if (!plan) throw planNotFound();
    const preview: TripPlanInvitedPreview = {
      id: plan.id,
      name: plan.name,
      startDate: dateOnly(plan.startDate),
      endDate: dateOnly(plan.endDate),
      tripTypes: plan.tripTypes,
      invitedBy: own.invitedBy,
      sections: plan.sections.map(sectionView),
      members: plan.members.map((m) => m.user),
    };
    res.json(preview);
  },
);

/**
 * An invited person joins: they are in. The
 * other active members are told. Exported for /plan-invites/redeem, where
 * someone invited by username who opens a link joins the same way.
 */
export async function joinInvited(
  planId: string,
  userId: string,
): Promise<void> {
  const push = await prisma.$transaction(async (tx) => {
    await touchPlan(tx, planId);
    const own = await tx.tripPlanMember.findUnique({
      where: { planId_userId: { planId, userId } },
      select: { status: true, plan: { select: { archivedAt: true } } },
    });
    if (own?.status !== "invited") throw planNotFound();
    if (own.plan.archivedAt) throw planArchived();
    await tx.tripPlanMember.update({
      where: { planId_userId: { planId, userId } },
      data: { status: "active" },
    });
    await dropStalePlanNotifications(tx, planId, userId);
    return notifyPlan(tx, await activeMemberIds(tx, planId, [userId]), {
      type: "plan_member_joined",
      payload: { planId, memberId: userId },
    });
  });
  push();
}

// ── POST /plans/:planId/join ──────────────────────────────────
// Only for someone invited by username.
router.post(
  "/join",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const planId = getParam(req.params.planId);
    await joinInvited(planId, user.id);
    res.json(
      await loadPlanView(user.id, await requirePlanMember(user.id, planId)),
    );
  },
);

/** A plan's active leaders other than `userId`. */
async function otherLeaders(
  tx: Prisma.TransactionClient,
  planId: string,
  userId: string,
): Promise<number> {
  return tx.tripPlanMember.count({
    where: {
      planId,
      status: "active",
      role: "leader",
      userId: { not: userId },
    },
  });
}

// ── PATCH /plans/:planId/members/:userId ──────────────────────
// Body { role }. A leader may step down only while another leader remains.
router.patch(
  "/members/:userId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, access, forbidden } = await leader(
      req,
      say`Only a leader can change roles.`,
    );
    const planId = access.plan.id;
    const memberId = target(req, userId);
    const role: unknown = req.body?.role;
    if (!isTripPlanRole(role)) throw malformed("role must be a plan role");
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      await requireStillLeader(tx, planId, userId, forbidden);
      const member = await tx.tripPlanMember.findUnique({
        where: { planId_userId: { planId, userId: memberId } },
        select: { status: true, role: true },
      });
      if (member?.status !== "active") throw memberNotFound();
      if (
        member.role === "leader" &&
        role !== "leader" &&
        (await otherLeaders(tx, planId, memberId)) === 0
      )
        throw new AppError(409, NEEDS_A_LEADER);
      await tx.tripPlanMember.update({
        where: { planId_userId: { planId, userId: memberId } },
        data: { role },
      });
      // Requests go to leaders; a former one's would only count in their
      // unread badge, since the inbox no longer shows them.
      if (member.role === "leader" && role !== "leader")
        await tx.notification.deleteMany({
          where: {
            userId: memberId,
            type: "plan_join_request",
            payload: { path: ["planId"], equals: planId },
          },
        });
    });
    res.json(await viewOfMember(planId, memberId));
  },
);

// ── POST /plans/:planId/members/:userId/approve ───────────────
// Let in someone who asked with a link. They join as a member.
router.post(
  "/members/:userId/approve",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, access, forbidden } = await leader(
      req,
      say`Only a leader can let people in.`,
    );
    const planId = access.plan.id;
    const requesterId = getParam(req.params.userId);
    const push = await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      await requireStillLeader(tx, planId, userId, forbidden);
      const { count } = await tx.tripPlanMember.updateMany({
        where: { planId, userId: requesterId, status: "requested" },
        data: { status: "active", role: "member" },
      });
      if (count === 0)
        throw new AppError(
          404,
          say`Couldn't find that request. Another leader may have answered it.`,
        );
      await dropStalePlanNotifications(tx, planId, requesterId);
      const approved = await notifyPlan(tx, [requesterId], {
        type: "plan_join_approved",
        payload: { planId, approvedById: userId },
      });
      const joined = await notifyPlan(
        tx,
        await activeMemberIds(tx, planId, [requesterId, userId]),
        {
          type: "plan_member_joined",
          payload: { planId, memberId: requesterId },
        },
      );
      return () => {
        approved();
        joined();
      };
    });
    push();
    res.json(await viewOfMember(planId, requesterId));
  },
);

// ── DELETE /plans/:planId/members/:userId ─────────────────────
// One endpoint for five intents, by who asks and where the person stands:
//   me, active      leave            answers go; what they added stays
//   me, invited     decline          the invite goes
//   me, requested   withdraw         the request and its answers go
//   leader, active  remove           as leave; they are told
//   leader, invited cancel the invite
//   leader, requested turn it down   they are told
// Works on an archived plan: leaving one must stay possible.
// What an active member added stays, charged as before; a leader's remove
// takes on the files charged to them. `?deleteAdded=true` on a leave and
// `?deleteFiles=true` on a remove delete those instead (lib/planItems.ts
// memberGone).
// `?status=` is where the caller saw the person stand, required on someone
// else, optional on yourself: a cancel or turn-down pressed on an old view
// must not remove someone who has joined since. Another status is 409, and
// nothing is deleted. Guard: planMembers.test.ts ("as the caller saw them").
router.delete(
  "/members/:userId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const planId = getParam(req.params.planId);
    const memberId = target(req, user.id);
    const self = memberId === user.id;
    if (self) await planMembershipAnyStatus(user.id, planId);
    else
      requirePlanRole(
        await requirePlanMember(user.id, planId),
        ["leader"],
        REMOVE,
      );
    const seen = req.query.status;
    if (seen !== undefined && !isTripPlanMemberStatus(seen))
      throw malformed("status must be invited, requested or active");
    if (!self && seen === undefined)
      throw malformed("status is required to remove someone else");

    const { late, push } = await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      if (!self) await requireStillLeader(tx, planId, user.id, REMOVE);
      // Read again behind the plan row: a leader may have answered since.
      const [member, plan] = await Promise.all([
        tx.tripPlanMember.findUnique({
          where: { planId_userId: { planId, userId: memberId } },
          select: { status: true, role: true },
        }),
        tx.tripPlan.findUniqueOrThrow({
          where: { id: planId },
          select: { name: true },
        }),
      ]);
      if (!member) throw self ? planNotFound() : memberNotFound();
      if (seen !== undefined && member.status !== seen)
        throw new AppError(
          409,
          say`Not done: this changed since you looked. Check who's in the plan, then try again.`,
        );
      if (
        self &&
        member.status === "active" &&
        (await activeMemberIds(tx, planId, [memberId])).length === 0
      )
        throw new AppError(
          409,
          say`You're the only one in this plan. Delete it instead.`,
        );
      if (
        member.status === "active" &&
        member.role === "leader" &&
        (await otherLeaders(tx, planId, memberId)) === 0
      )
        throw new AppError(409, NEEDS_A_LEADER);
      const late =
        member.status === "active"
          ? await memberGone(tx, {
              planId,
              memberId,
              removedBy: self ? null : user.id,
              deleteAdded: self && req.query.deleteAdded === "true",
              deleteFiles: !self && req.query.deleteFiles === "true",
            })
          : async () => {};
      await dropMembership(tx, planId, memberId);
      if (self || member.status === "invited") return { late, push: () => {} };
      const push = await notifyPlan(tx, [memberId], {
        type: "plan_access_ended",
        payload: {
          planId,
          reason: member.status === "active" ? "removed" : "declined",
          planName: plan.name,
        },
      });
      return { late, push };
    });
    push();
    await late();
    res.status(204).send();
  },
);

export default router;
