// Who may do what in a plan (Plans). Every /plans/:planId route decides here.
//
// Only an ACTIVE member reaches a plan: someone invited, asking to join, or
// never in it gets the same 404 a missing plan gets (ADR 0002's rule), and a
// member without the role gets a 403 naming who can. Plan rows reach no one
// through the owner routes (`placeAccess.getPlaceRole` returns "none" for a
// plan place), so this file is the only way in.
// Guard: planAccess.unit.test.ts, __tests__/plans.test.ts,
// __tests__/tripPlanRows.test.ts.
import { Prisma } from "@prisma/client";
import {
  isTripPlanRole,
  say,
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

/** 403 with `forbidden` unless the caller's role is one of `roles`. */
export function requirePlanRole(
  access: PlanAccess,
  roles: readonly TripPlanRole[],
  forbidden: UserSentence,
): void {
  if (!roles.includes(access.role)) throw new AppError(403, forbidden);
}

/** For a write to the plan's content: an active member, and not archived. */
export async function requirePlanWrite(
  userId: string,
  planId: string,
): Promise<PlanAccess> {
  const access = await requirePlanMember(userId, planId);
  if (access.plan.archivedAt)
    throw new AppError(
      409,
      say`This plan is archived. A leader can bring it back to change it.`,
    );
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
 * Move the plan's `updatedAt`, the Plans poll's watermark, as the FIRST
 * statement of a write to anything in it. A child row's own `updatedAt`
 * never reaches the poll. Being first, its row lock also makes writes in one
 * plan run one at a time, so a count, a next position or an order check read
 * after it can't be raced by a second write. A plan deleted meanwhile is 404.
 * Guard: __tests__/plans.test.ts ("touches the plan").
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
