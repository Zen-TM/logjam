// Who may do what in a plan (Plans). Every /plans/:planId route decides here.
//
// Only an ACTIVE member reaches a plan: someone invited, asking to join, or
// never in it gets the same 404 a missing plan gets (ADR 0002's rule), and a
// member without the role gets a 403 naming who can. The one thing short of
// that is `planMembershipAnyStatus`, for the routes about a person's own
// membership: the invited preview, declining and withdrawing (joining
// re-checks "invited" inside its transaction, behind the plan row). Plan rows
// reach no one through the owner routes (`placeAccess.getPlaceRole` returns
// "none" for a plan place), so this file is the only way in.
// Guard: planAccess.unit.test.ts, __tests__/plans.test.ts,
// __tests__/tripPlanRows.test.ts, __tests__/planMembers.test.ts.
import { Prisma } from "@prisma/client";
import {
  isTripPlanRole,
  say,
  TRIP_PLAN_CHANGED_SENTENCE,
  type TripPlanRole,
  type UserSentence,
} from "@logjam/shared";
import prisma from "../services/prisma";
import { AppError, fault } from "../middleware/errorHandler";

export type PlanAccess = {
  plan: { id: string; createdById: string | null; archivedAt: Date | null };
  role: TripPlanRole;
  /** TripPlanMember.id */
  memberId: string;
};

export function planNotFound(): AppError {
  return new AppError(404, say`Couldn't find that plan.`);
}

export function planArchived(): AppError {
  return new AppError(
    409,
    say`This plan is archived. A leader can bring it back to change it.`,
  );
}

/** 404 unless the caller is an active member of the plan. */
export async function requirePlanMember(
  userId: string,
  planId: string,
): Promise<PlanAccess> {
  const member = await prisma.tripPlanMember.findUnique({
    where: { planId_userId: { planId, userId } },
    select: {
      id: true,
      role: true,
      status: true,
      plan: { select: { id: true, createdById: true, archivedAt: true } },
    },
  });
  if (!member || member.status !== "active") throw planNotFound();
  if (!isTripPlanRole(member.role))
    throw fault("a member row has no known role");
  return { plan: member.plan, role: member.role, memberId: member.id };
}

/** The caller's own membership, of any status, or 404 when they have none.
 *  Grants nothing by itself: its caller checks the status it needs. */
export async function planMembershipAnyStatus(
  userId: string,
  planId: string,
): Promise<{
  status: string;
  invitedBy: { id: string; username: string } | null;
}> {
  const row = await prisma.tripPlanMember.findUnique({
    where: { planId_userId: { planId, userId } },
    select: {
      status: true,
      invitedBy: { select: { id: true, username: true } },
    },
  });
  if (!row) throw planNotFound();
  return row;
}

/** 403 with `forbidden` unless the caller's role is one of `roles`. */
export function requirePlanRole(
  access: PlanAccess,
  roles: readonly TripPlanRole[],
  forbidden: UserSentence,
): void {
  if (!roles.includes(access.role)) throw new AppError(403, forbidden);
}

/**
 * For a leader's write to who is in the plan, after touchPlan: the caller is
 * still in it (else 404, as for anyone not in a plan) and still leads (else
 * 403). A check made before the lock can be stale by the time it is held,
 * and two leaders demoting or removing each other would then leave the plan
 * with none.
 * Guard: __tests__/planMembers.test.ts ("a plan keeps a leader").
 */
export async function requireStillLeader(
  tx: Prisma.TransactionClient,
  planId: string,
  userId: string,
  forbidden: UserSentence,
): Promise<void> {
  const caller = await tx.tripPlanMember.findUnique({
    where: { planId_userId: { planId, userId } },
    select: { status: true, role: true },
  });
  if (caller?.status !== "active") throw planNotFound();
  if (caller.role !== "leader") throw new AppError(403, forbidden);
}

/** For a write to the plan's content: an active member, and not archived. */
export async function requirePlanWrite(
  userId: string,
  planId: string,
): Promise<PlanAccess> {
  const access = await requirePlanMember(userId, planId);
  if (access.plan.archivedAt) throw planArchived();
  return access;
}

/** A member may change only what they added; an editor or a leader anything. */
export function canChangeItem(
  access: PlanAccess,
  item: { addedById: string | null },
  userId: string,
): boolean {
  return access.role !== "member" || item.addedById === userId;
}

/**
 * What a compare-and-set that changed no row answers: 404 when the plan has
 * gone meanwhile (a DELETE landed after the access check), else 409.
 * Guard: planAccess.unit.test.ts ("casMissed").
 */
export async function casMissed(
  db: { tripPlan: { count(args: { where: { id: string } }): Promise<number> } },
  planId: string,
): Promise<AppError> {
  return (await db.tripPlan.count({ where: { id: planId } }))
    ? new AppError(409, TRIP_PLAN_CHANGED_SENTENCE)
    : planNotFound();
}

/**
 * Move the plan's `updatedAt`, the Plans poll's watermark, as the FIRST
 * statement of a write to anything in it. A child row's own `updatedAt`
 * never reaches the poll. Being first, its UPDATE holds the plan row until
 * commit, so writes in one plan run one at a time and, at Postgres's READ
 * COMMITTED, a count, a next position or an order check read after it sees
 * every write committed before. A plan deleted meanwhile is 404.
 * Guards: __tests__/plans.test.ts ("touches the plan"; "holds the cap
 * against creates that race" for the cap and positions), and
 * planAccess.unit.test.ts ("touchPlan") for the 404.
 */
export async function touchPlan(
  tx: Prisma.TransactionClient,
  planId: string,
): Promise<void> {
  const { count } = await tx.tripPlan.updateMany({
    where: { id: planId },
    data: { updatedAt: new Date() },
  });
  if (count === 0) throw planNotFound();
}
