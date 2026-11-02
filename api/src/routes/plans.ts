// Plans: a group's shared space for one trip. This file holds the plan
// itself; its sections, forms, members and items have their own route files
// under /plans/:planId. Access is lib/planAccess.ts's alone.
import { Router, Response } from "express";
import {
  isTripPlanFormPresetId,
  isTripPlanFormVisibility,
  parseTripPlanCreate,
  parseTripPlanPatch,
  say,
  type TripPlanLeaderForm,
  type TripPlanQuestion,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { accepted, fault, malformed } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  casMissed,
  planNotFound,
  requirePlanMember,
  requirePlanRole,
  requirePlanWrite,
} from "../lib/planAccess";
import { endPlanForOthers, waitingFor } from "../lib/planMembership";
import { deletePlanWithFiles } from "../lib/planItems";
import {
  dateColumn,
  loadPlanView,
  planSummary,
  formsAnsweredBy,
  unanswered,
} from "../lib/tripPlanView";

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
        forms: formsAnsweredBy(user.id),
      },
      orderBy: [
        { startDate: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
    });
    res.json({
      plans: await Promise.all(
        plans.map(async (plan) => {
          const membership = plan.members[0];
          return planSummary(
            plan,
            membership,
            membership.status === "requested"
              ? await waitingFor(
                  prisma,
                  plan.id,
                  membership.invitedBy?.id ?? null,
                )
              : null,
            unanswered(plan.forms),
          );
        }),
      ),
    });
  },
);

// ── GET /plans/leader-forms ───────────────────────────────────
// The forms of the plans the caller actively leads, for "copy from my
// plans". Registered before /:id. Another role never sees a plan's forms
// here. Guard: __tests__/planForms.test.ts ("copy from my plans").
router.get(
  "/leader-forms",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const except = typeof req.query.except === "string" ? req.query.except : "";
    const led = await prisma.tripPlanMember.findMany({
      where: {
        userId: user.id,
        role: "leader",
        status: "active",
        planId: { not: except },
      },
      select: { plan: { select: { id: true, name: true, updatedAt: true } } },
    });
    const plans = led
      .map((row) => row.plan)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const found = await prisma.tripPlanForm.findMany({
      where: { planId: { in: plans.map((plan) => plan.id) } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        planId: true,
        title: true,
        preset: true,
        questions: true,
        visibleTo: true,
      },
    });
    // ponytail: no paging; add it if leaders come to lead many plans.
    const rows = plans
      .flatMap((plan) =>
        found
          .filter((form) => form.planId === plan.id)
          .map((form) => ({ ...form, plan })),
      )
      .slice(0, 200);
    const forms: TripPlanLeaderForm[] = rows.map((row) => {
      if (!isTripPlanFormVisibility(row.visibleTo))
        throw fault("a form row has no known visibility");
      return {
        planId: row.plan.id,
        planName: row.plan.name,
        formId: row.id,
        title: row.title,
        preset:
          row.preset && isTripPlanFormPresetId(row.preset) ? row.preset : null,
        questions: (Array.isArray(row.questions)
          ? row.questions
          : []) as TripPlanQuestion[],
        visibleTo: row.visibleTo,
      };
    });
    res.json({ forms });
  },
);

// ── POST /plans ───────────────────────────────────────────────
// The caller leads it. It starts with no section; the leader adds what they want.
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
    if (count === 0) throw await casMissed(prisma, access.plan.id);
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
    const { count } = await prisma.tripPlan.updateMany({
      where: { id: access.plan.id },
      data: {
        archivedAt: archived ? (access.plan.archivedAt ?? new Date()) : null,
      },
    });
    if (count === 0) throw planNotFound();
    const plan = await prisma.tripPlan.findUnique({
      where: { id: access.plan.id },
      include: {
        members: {
          where: { userId: user.id },
          select: { role: true, status: true, invitedBy },
        },
        forms: formsAnsweredBy(user.id),
      },
    });
    if (!plan) throw planNotFound();
    res.json(planSummary(plan, plan.members[0], null, unanswered(plan.forms)));
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
    // Files first: S3, then refunds in the delete's transaction
    // (lib/planItems.ts).
    const planId = access.plan.id;
    const push = await deletePlanWithFiles(planId, (tx) =>
      endPlanForOthers(tx, planId, user.id),
    );
    push();
    res.status(204).send();
  },
);

export default router;
