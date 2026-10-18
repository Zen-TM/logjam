// The /plans responses, built from rows. Who sees which answer is decided
// here, once, for the full fetch and every write that returns a form.
// Guard: __tests__/planForms.test.ts ("leaders-only answers").
import {
  currentTripPlanAnswers,
  isTripPlanFormPresetId,
  isTripPlanFormVisibility,
  isTripPlanMemberStatus,
  isTripPlanRole,
  type TripPlanAnswerView,
  type TripPlanFormView,
  type TripPlanMemberStatus,
  type TripPlanMemberView,
  type TripPlanQuestion,
  type TripPlanRole,
  type TripPlanSectionView,
  type TripPlanSummary,
  type TripPlanView,
} from "@logjam/shared";
import prisma from "../services/prisma";
import { fault } from "../middleware/errorHandler";
import { planNotFound, type PlanAccess } from "./planAccess";

const userRef = { select: { id: true, username: true } } as const;

export function dateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** "YYYY-MM-DD" as the Date a `@db.Date` column takes. */
export function dateColumn(day: string | null): Date | null {
  return day ? new Date(`${day}T00:00:00Z`) : null;
}

function role(value: string): TripPlanRole {
  if (!isTripPlanRole(value)) throw fault("a member row has no known role");
  return value;
}

function status(value: string): TripPlanMemberStatus {
  if (!isTripPlanMemberStatus(value))
    throw fault("a member row has no known status");
  return value;
}

type PlanRow = {
  id: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  tripTypes: string[];
  archivedAt: Date | null;
  updatedAt: Date;
};

export function planSummary(
  plan: PlanRow,
  membership: {
    role: string;
    status: string;
    invitedBy: { id: string; username: string } | null;
  },
  /** For a request: who it waits for (lib/planMembership.ts `waitingFor`). */
  waitingFor: { id: string; username: string } | null = null,
): TripPlanSummary {
  const summary: TripPlanSummary = {
    id: plan.id,
    name: plan.name,
    startDate: dateOnly(plan.startDate),
    endDate: dateOnly(plan.endDate),
    tripTypes: plan.tripTypes,
    archivedAt: plan.archivedAt?.toISOString() ?? null,
    updatedAt: plan.updatedAt.toISOString(),
    status: status(membership.status),
    role: role(membership.role),
  };
  if (summary.status === "invited" && membership.invitedBy)
    summary.invitedBy = membership.invitedBy;
  if (summary.status === "requested" && waitingFor)
    summary.waitingFor = waitingFor;
  return summary;
}

export const memberInclude = { user: userRef, invitedBy: userRef } as const;

export function memberView(row: {
  user: { id: string; username: string };
  invitedBy: { id: string; username: string } | null;
  role: string;
  status: string;
  createdAt: Date;
}): TripPlanMemberView {
  return {
    user: row.user,
    role: role(row.role),
    status: status(row.status),
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function sectionView(row: {
  id: string;
  title: string;
  body: string;
  position: number;
  updatedAt: Date;
}): TripPlanSectionView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    position: row.position,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const formInclude = {
  answers: {
    select: { answers: true, updatedAt: true, user: userRef },
    orderBy: { createdAt: "asc" },
  },
} as const;

type FormRow = {
  id: string;
  title: string;
  preset: string | null;
  questions: unknown;
  visibleTo: string;
  requiredToJoin: boolean;
  position: number;
  updatedAt: Date;
  answers: {
    answers: unknown;
    updatedAt: Date;
    user: { id: string; username: string };
  }[];
};

/** Everyone's membership status in the plan, for `formView`. */
export async function memberStatuses(
  planId: string,
): Promise<Map<string, string>> {
  const rows = await prisma.tripPlanMember.findMany({
    where: { planId },
    select: { userId: true, status: true },
  });
  return new Map(rows.map((row) => [row.userId, row.status]));
}

/**
 * A form as `viewer` may see it. Their own answer always; someone else's
 * only to a leader, or to anyone when the form's answers are for everyone
 * and its author is in the plan (a leader also sees the answers of someone
 * asking to join). Never anyone's answer whose author is in no plan row.
 * Guard: __tests__/planForms.test.ts ("leaders-only answers reach …", "an
 * answer whose author is no longer in the plan reaches no one").
 */
export function formView(
  form: FormRow,
  viewer: { userId: string; role: TripPlanRole },
  statuses: Map<string, string>,
): TripPlanFormView {
  if (!isTripPlanFormVisibility(form.visibleTo))
    throw fault("a form row has no known visibility");
  const questions = (
    Array.isArray(form.questions) ? form.questions : []
  ) as TripPlanQuestion[];
  const answerView = (row: FormRow["answers"][number]): TripPlanAnswerView => ({
    user: row.user,
    answers: currentTripPlanAnswers(questions, row.answers),
    updatedAt: row.updatedAt.toISOString(),
  });
  const mine = form.answers.find((row) => row.user.id === viewer.userId);
  const others = form.answers.filter((row) => {
    if (row.user.id === viewer.userId) return false;
    const author = statuses.get(row.user.id);
    if (viewer.role === "leader") return author !== undefined;
    return form.visibleTo === "members" && author === "active";
  });
  return {
    id: form.id,
    title: form.title,
    preset:
      form.preset && isTripPlanFormPresetId(form.preset) ? form.preset : null,
    questions,
    visibleTo: form.visibleTo,
    requiredToJoin: form.requiredToJoin,
    position: form.position,
    updatedAt: form.updatedAt.toISOString(),
    myAnswer: mine ? answerView(mine) : null,
    answers: others.map(answerView),
  };
}

/** GET /plans/:id, the full fetch: everything an active member may see. */
export async function loadPlanView(
  userId: string,
  access: PlanAccess,
): Promise<TripPlanView> {
  const plan = await prisma.tripPlan.findUnique({
    where: { id: access.plan.id },
    include: {
      createdBy: userRef,
      sections: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      members: {
        include: memberInclude,
        orderBy: { createdAt: "asc" },
      },
      forms: {
        include: formInclude,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!plan) throw planNotFound();
  const viewer = { userId, role: access.role };
  const statuses = new Map(plan.members.map((m) => [m.userId, m.status]));
  // Who is invited or asking to join is the leaders' business.
  // Guard: __tests__/plans.test.ts ("shows who is invited or asking only to leaders").
  const members: TripPlanMemberView[] = plan.members
    .filter((m) => access.role === "leader" || m.status === "active")
    .map(memberView);
  return {
    id: plan.id,
    name: plan.name,
    startDate: dateOnly(plan.startDate),
    endDate: dateOnly(plan.endDate),
    tripTypes: plan.tripTypes,
    archivedAt: plan.archivedAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    createdBy: plan.createdBy,
    myRole: access.role,
    sections: plan.sections.map(sectionView),
    members,
    // Empty until items can be added to a plan (#439).
    places: [],
    routes: [],
    files: [],
    geoPdfs: [],
    forms: plan.forms.map((form) => formView(form, viewer, statuses)),
  };
}
