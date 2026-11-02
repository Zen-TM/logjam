// Joining a plan and telling people about it: what /plans/:planId/members,
// /plans/:planId/join and /plan-invites share.
//
// A plan_* notification stores ids only (plan_access_ended also the plan's
// name, routes/notifications.ts says why) and is pushed with a static title
// and the plan's id (services/push.ts). Never an answer, a label or a
// coordinate. Guard: __tests__/planMembers.test.ts ("removing tells the
// person which plan, with no answers").
import { Prisma } from "@prisma/client";
import type { TripPlanUserRef } from "@logjam/shared";
import { sendPushToUser } from "../services/push";

type Db = Prisma.TransactionClient;

/**
 * The plan types that name a user other than their recipient, and the
 * payload key that holds that user. One declaration for the writers here,
 * the read (routes/notifications.ts) and the account purge (routes/users.ts).
 * Guard: routes/accountPurge.unit.test.ts.
 */
export const PLAN_PERSON_KEY = {
  plan_invited: "invitedById",
  plan_join_request: "requesterId",
  plan_join_approved: "approvedById",
  plan_member_joined: "memberId",
} as const;
type NamingType = keyof typeof PLAN_PERSON_KEY;
export const PLAN_NAMING_TYPES = Object.keys(PLAN_PERSON_KEY) as NamingType[];

/** The payload key of the person a notification `type` names, if it is one
 *  of these. */
export function planPersonKey(type: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(PLAN_PERSON_KEY, type)
    ? PLAN_PERSON_KEY[type as NamingType]
    : undefined;
}

type PlanNotice =
  | {
      [T in NamingType]: {
        type: T;
        payload: { planId: string } & Record<
          (typeof PLAN_PERSON_KEY)[T],
          string
        >;
      };
    }[NamingType]
  | {
      type: "plan_access_ended";
      payload: {
        planId: string;
        reason: "removed" | "declined" | "deleted";
        planName: string;
      };
    };

/**
 * Write `notice` for each of `userIds` in the transaction. Returns the pushes
 * to send once it commits.
 */
export async function notifyPlan(
  tx: Db,
  userIds: string[],
  notice: PlanNotice,
): Promise<() => void> {
  if (userIds.length > 0)
    await tx.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: notice.type,
        payload: notice.payload,
      })),
    });
  return () => {
    for (const userId of userIds)
      void sendPushToUser(userId, {
        type: notice.type,
        planId: notice.payload.planId,
      });
  };
}

/** Rows about `userId` in the plan that their membership change made stale:
 *  their own, and anyone's naming them as a requester or a joiner. A read
 *  drops these too (routes/notifications.ts); this keeps the table clean. */
export async function dropStalePlanNotifications(
  tx: Db,
  planId: string,
  userId: string,
): Promise<void> {
  await tx.notification.deleteMany({
    where: {
      type: { in: PLAN_NAMING_TYPES },
      payload: { path: ["planId"], equals: planId },
      OR: [
        { userId },
        { payload: { path: ["requesterId"], equals: userId } },
        { payload: { path: ["memberId"], equals: userId } },
      ],
    },
  });
}

/**
 * Someone out of the plan, in its transaction: their answers, their member
 * row and the notifications that named them. A leave, a remove and an
 * account's hand-over (lib/planItems.ts handOverPlans) all end this way.
 */
export async function dropMembership(
  tx: Db,
  planId: string,
  userId: string,
): Promise<void> {
  await tx.tripPlanAnswer.deleteMany({ where: { userId, form: { planId } } });
  await tx.tripPlanMember.deleteMany({ where: { planId, userId } });
  await dropStalePlanNotifications(tx, planId, userId);
}

/** Every row about the plan but the ones saying it ended. */
export async function dropPlanNotifications(
  tx: Db,
  planId: string,
): Promise<void> {
  await tx.notification.deleteMany({
    where: {
      type: { in: PLAN_NAMING_TYPES },
      payload: { path: ["planId"], equals: planId },
    },
  });
}

/**
 * The plan is about to be deleted: drop its notifications and tell everyone
 * else with a row (members, and anyone invited or asking, who would otherwise
 * find the plan gone from their list unexplained). In the delete's
 * transaction; returns the push to send after commit.
 * Guard: __tests__/planItems.test.ts ("deletes a plan left empty").
 */
export async function endPlanForOthers(
  tx: Db,
  planId: string,
  exceptUserId: string,
): Promise<() => void> {
  const [plan, others] = await Promise.all([
    tx.tripPlan.findUniqueOrThrow({
      where: { id: planId },
      select: { name: true },
    }),
    tx.tripPlanMember.findMany({
      where: { planId, userId: { not: exceptUserId } },
      select: { userId: true },
    }),
  ]);
  await dropPlanNotifications(tx, planId);
  return notifyPlan(
    tx,
    others.map((row) => row.userId),
    {
      type: "plan_access_ended",
      payload: { planId, reason: "deleted", planName: plan.name },
    },
  );
}

/** Whether `userId` and any of `otherIds` have blocked each other, either
 *  way. A block is answered as if there were no one there. */
export async function blockedWithAny(
  db: Db,
  userId: string,
  otherIds: string[],
): Promise<boolean> {
  const blocked = await db.friendship.count({
    where: {
      status: "blocked",
      OR: [
        { requesterId: userId, addresseeId: { in: otherIds } },
        { requesterId: { in: otherIds }, addresseeId: userId },
      ],
    },
  });
  return blocked > 0;
}

/** Active members' ids, minus `except`. */
export async function activeMemberIds(
  db: Db,
  planId: string,
  except: string[],
  role?: "leader",
): Promise<string[]> {
  const rows = await db.tripPlanMember.findMany({
    where: {
      planId,
      status: "active",
      ...(role && { role }),
      userId: { notIn: except },
    },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

/**
 * Who a request waits for: the leader whose link it came by while they still
 * lead, else the earliest active leader. Null only for a plan left with no
 * leader.
 */
export async function waitingFor(
  db: Db,
  planId: string,
  invitedById: string | null,
): Promise<TripPlanUserRef | null> {
  const leaders = await db.tripPlanMember.findMany({
    where: { planId, status: "active", role: "leader" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { id: true, username: true } } },
  });
  return (
    (leaders.find((row) => row.user.id === invitedById) ?? leaders[0])?.user ??
    null
  );
}
