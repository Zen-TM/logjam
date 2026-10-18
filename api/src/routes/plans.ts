// Plans: a group's shared space for one trip. This file holds the plan
// itself; its sections, forms, members and items have their own route files
// under /plans/:planId. Access is lib/planAccess.ts's alone.
import { Router, Response } from "express";
import {
  parseTripPlanCreate,
  parseTripPlanPatch,
  say,
  TRIP_PLAN_CHANGED_SENTENCE,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { accepted, AppError, malformed } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  planNotFound,
  requirePlanMember,
  requirePlanRole,
  requirePlanWrite,
} from "../lib/planAccess";
import { dateColumn, loadPlanView, planSummary } from "../lib/tripPlanView";

const router = Router();

const invitedBy = { select: { id: true, username: true } } as const;

// ── GET /plans ────────────────────────────────────────────────
// The cheap poll: every plan the caller is in, invited to or asking to join,
// with no child data. A plan's `updatedAt` moves on any change inside it.
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const plans = await prisma.tripPlan.findMany({
      where: { members: { some: { userId: user.id } } },
      include: {
        members: {
          where: { userId: user.id },
          select: { role: true, status: true, invitedBy },
        },
      },
      orderBy: [
        { startDate: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
    });
    res.json({
      plans: plans.map((plan) => planSummary(plan, plan.members[0])),
    });
  },
);

// ── POST /plans ───────────────────────────────────────────────
// The caller leads it. It starts with one empty section, Overview.
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const input = accepted(parseTripPlanCreate(req.body));
    const plan = await prisma.tripPlan.create({
      data: {
        createdById: user.id,
        name: input.name,
        startDate: dateColumn(input.startDate),
        endDate: dateColumn(input.endDate),
        tripTypes: input.tripTypes,
        members: {
          create: { userId: user.id, role: "leader", status: "active" },
        },
        sections: { create: { title: "Overview", position: 0 } },
      },
      select: { id: true },
    });
    const access = await requirePlanMember(user.id, plan.id);
    res.status(201).json(await loadPlanView(user.id, access));
  },
);

// ── GET /plans/:id ────────────────────────────────────────────
// The full fetch: what Logjam Web renders and Logjam GPS caches.
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanMember(user.id, getParam(req.params.id));
    res.json(await loadPlanView(user.id, access));
  },
);

// ── PATCH /plans/:id ──────────────────────────────────────────
// Compare-and-set: every field sent saves only if its `from` is still what
// is stored, all in one statement. A 409 carries no current value; the
// client refetches.
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanWrite(user.id, getParam(req.params.id));
    requirePlanRole(
      access,
      ["leader", "editor"],
      say`Only a leader or an editor can change the plan.`,
    );
    const patch = accepted(parseTripPlanPatch(req.body));
    const { count } = await prisma.tripPlan.updateMany({
      where: {
        id: access.plan.id,
        ...(patch.name && { name: patch.name.from }),
        ...(patch.dates && {
          startDate: dateColumn(patch.dates.from.startDate),
          endDate: dateColumn(patch.dates.from.endDate),
        }),
        ...(patch.tripTypes && { tripTypes: { equals: patch.tripTypes.from } }),
      },
      data: {
        ...(patch.name && { name: patch.name.to }),
        ...(patch.dates && {
          startDate: dateColumn(patch.dates.to.startDate),
          endDate: dateColumn(patch.dates.to.endDate),
        }),
        ...(patch.tripTypes && { tripTypes: patch.tripTypes.to }),
      },
    });
    if (count === 0) {
      const still = await prisma.tripPlan.count({
        where: { id: access.plan.id },
      });
      throw still
        ? new AppError(409, TRIP_PLAN_CHANGED_SENTENCE)
        : planNotFound();
    }
    res.json(await loadPlanView(user.id, access));
  },
);

// ── POST /plans/:id/archive ───────────────────────────────────
// Body { archived: boolean }. An archived plan is read-only until a leader
// brings it back; it stays in everyone's list, under Archived.
router.post(
  "/:id/archive",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanMember(user.id, getParam(req.params.id));
    requirePlanRole(
      access,
      ["leader"],
      say`Only a leader can archive this plan.`,
    );
    const archived = req.body?.archived;
    if (typeof archived !== "boolean")
      throw malformed("archived must be a boolean");
    const plan = await prisma.tripPlan.update({
      where: { id: access.plan.id },
      data: {
        archivedAt: archived ? (access.plan.archivedAt ?? new Date()) : null,
      },
      include: {
        members: {
          where: { userId: user.id },
          select: { role: true, status: true, invitedBy },
        },
      },
    });
    res.json(planSummary(plan, plan.members[0]));
  },
);

// ── DELETE /plans/:id ─────────────────────────────────────────
// Everything in the plan goes with it, for everyone; copies people saved to
// their own accounts stay.
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanMember(user.id, getParam(req.params.id));
    requirePlanRole(
      access,
      ["leader"],
      say`Only a leader can delete this plan.`,
    );
    // Hold #439: a plan's files can't be added yet, so there are no S3
    // objects or storage charges to undo here; and no plan_* notification
    // type exists yet, so the other members aren't told (plan_access_ended,
    // reason "deleted", sent in this delete's transaction, is P3's).
    const { count } = await prisma.tripPlan.deleteMany({
      where: { id: access.plan.id },
    });
    if (count === 0) throw planNotFound();
    res.status(204).send();
  },
);

export default router;
