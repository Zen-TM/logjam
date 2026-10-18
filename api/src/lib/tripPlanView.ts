// The /plans responses, built from rows.
import {
  isTripPlanMemberStatus,
  isTripPlanRole,
  type TripPlanMemberStatus,
  type TripPlanMemberView,
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
  return summary;
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
        include: { user: userRef, invitedBy: userRef },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!plan) throw planNotFound();
  // Who is invited or asking to join is the leaders' business (design O-13).
  const members: TripPlanMemberView[] = plan.members
    .filter((m) => access.role === "leader" || m.status === "active")
    .map((m) => ({
      user: m.user,
      role: role(m.role),
      status: status(m.status),
      invitedBy: m.invitedBy,
      createdAt: m.createdAt.toISOString(),
    }));
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
    // Hold #439: forms arrive with their routes.
    forms: [],
  };
}
