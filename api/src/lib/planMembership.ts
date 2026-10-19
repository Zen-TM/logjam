// Joining a plan and telling people about it: what /plans/:planId/members,
// /plans/:planId/join and /plan-invites share.
//
// A plan_* notification stores ids only (plan_access_ended also the plan's
// name, routes/notifications.ts says why) and is pushed with a static title
// and the plan's id (services/push.ts). Never an answer, a label or a
// coordinate. Guard: __tests__/planMembers.test.ts ("removing tells the
// person which plan, with no answers").
import { Prisma } from "@prisma/client";
import {
  isTripPlanFormVisibility,
  parseTripPlanAnswers,
  say,
  TRIP_PLAN_FORM_CHANGED_SENTENCE,
  TRIP_PLAN_MAX_FORMS,
  TRIP_PLAN_VISIBILITY_CHANGED_SENTENCE,
  type TripPlanJoinForm,
  type TripPlanQuestion,
  type TripPlanUserRef,
} from "@logjam/shared";
import {
  accepted,
  AppError,
  fault,
  malformed,
} from "../middleware/errorHandler";
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

/** The forms required to join, as a joiner sees them: no answers. */
export async function joinForms(
  db: Db,
  planId: string,
): Promise<TripPlanJoinForm[]> {
  const forms = await db.tripPlanForm.findMany({
    where: { planId, requiredToJoin: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      questions: true,
      visibleTo: true,
      updatedAt: true,
    },
  });
  return forms.map((form) => {
    if (!isTripPlanFormVisibility(form.visibleTo))
      throw fault("a form row has no known visibility");
    return {
      id: form.id,
      title: form.title,
      questions: (Array.isArray(form.questions)
        ? form.questions
        : []) as TripPlanQuestion[],
      visibleTo: form.visibleTo,
      updatedAt: form.updatedAt.toISOString(),
    };
  });
}

type LockedForm = {
  id: string;
  questions: unknown;
  visible_to: string;
  updated_at: Date;
};

/**
 * Store a joiner's answers (TripPlanJoinAnswers), each checked against the
 * form as they were shown it, as PUT …/answers/me checks one: who sees it
 * first, then whether the form changed, then the answers. Every form
 * required to join must be answered. Call after touchPlan; the forms are
 * then locked FOR SHARE, as the answer PUT locks one (routes/planForms.ts).
 */
export async function saveJoinAnswers(
  tx: Db,
  planId: string,
  userId: string,
  value: unknown,
): Promise<void> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw malformed("answers must map form ids to answers");
  const given = value as Record<string, unknown>;
  const ids = Object.keys(given).sort();
  if (ids.length > TRIP_PLAN_MAX_FORMS)
    throw malformed("more answered forms than a plan can have", 413);
  const forms =
    ids.length > 0
      ? await tx.$queryRaw<LockedForm[]>`
          SELECT id, questions, visible_to, updated_at FROM trip_plan_forms
          WHERE plan_id = ${planId} AND id = ANY(${ids}) FOR SHARE`
      : [];
  // A form gone since it was shown: the person answered a form that changed.
  if (forms.length !== ids.length)
    throw new AppError(409, TRIP_PLAN_FORM_CHANGED_SENTENCE);
  const missing = await tx.tripPlanForm.count({
    where: { planId, requiredToJoin: true, id: { notIn: ids } },
  });
  if (missing > 0)
    throw new AppError(400, say`Answer the forms marked required to join.`);
  const answers = forms.map((form) => {
    const entry = given[form.id];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw malformed("each form's entry must be an object");
    const { visibleTo, formUpdatedAt } = entry as Record<string, unknown>;
    if (!isTripPlanFormVisibility(visibleTo))
      throw malformed("visibleTo must be the visibility the form showed");
    if (typeof formUpdatedAt !== "string")
      throw malformed("formUpdatedAt must be the form's updatedAt as served");
    if (form.visible_to !== visibleTo)
      throw new AppError(409, TRIP_PLAN_VISIBILITY_CHANGED_SENTENCE);
    if (form.updated_at.toISOString() !== formUpdatedAt)
      throw new AppError(409, TRIP_PLAN_FORM_CHANGED_SENTENCE);
    return {
      formId: form.id,
      answers: accepted(
        parseTripPlanAnswers(
          form.questions as TripPlanQuestion[],
          (entry as Record<string, unknown>).answers,
        ),
      ),
    };
  });
  for (const row of answers)
    await tx.tripPlanAnswer.upsert({
      where: { formId_userId: { formId: row.formId, userId } },
      create: { formId: row.formId, userId, answers: row.answers },
      update: { answers: row.answers },
    });
}
