// A plan's forms and the answers members give them. Leaders build forms;
// every member answers for themselves, last write wins.
//
// WHO SEES AN ANSWER NEVER WIDENS AFTER IT WAS GIVEN, following root
// AGENTS.md's "no default widens who sees something": a leader may turn a
// form from "everyone" to "leaders" at any time, but back only while no one
// else has answered; and an answer carries the visibility its author was
// shown, refused if it has changed since. Guard for the refusals:
// __tests__/planForms.test.ts ("never widening who sees an answer").
//
// The two can't interleave. Every write here starts with touchPlan, whose
// UPDATE holds the plan row until commit, so writes in one plan run one at a
// time and, at Postgres's READ COMMITTED, each reads what the one before
// committed (guard for the forms cap: __tests__/planForms.test.ts "holds the
// cap against creates that race"). `lockForm` then also locks the form row (FOR UPDATE in the
// PATCH, FOR SHARE in the answer PUT), which keeps the pair exclusive for a
// writer elsewhere that answers without touching the plan first. Plan row
// before any row in the plan, everywhere: here, and in account delete
// (routes/users.ts), the one other writer that takes rows in plans, which
// first updates every plan its user is in or created, taking their rows,
// before it deletes their answers and memberships.
// Reading answers is lib/tripPlanView.ts's `formView`.
import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  isTripPlanFormVisibility,
  parseTripPlanAnswers,
  parseTripPlanFormCreate,
  parseTripPlanFormPatch,
  parseTripPlanOrder,
  say,
  TRIP_PLAN_CHANGED_SENTENCE,
  TRIP_PLAN_FORM_CHANGED_SENTENCE,
  TRIP_PLAN_MAX_FORMS,
  TRIP_PLAN_VISIBILITY_CHANGED_SENTENCE,
  type TripPlanQuestion,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { accepted, AppError, malformed } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  requirePlanRole,
  requirePlanWrite,
  touchPlan,
  type PlanAccess,
} from "../lib/planAccess";
import { formInclude, formView, memberStatuses } from "../lib/tripPlanView";

const router = Router({ mergeParams: true });

const ORDER = [{ position: "asc" }, { createdAt: "asc" }] as const;

function formNotFound(): AppError {
  return new AppError(404, say`Couldn't find that.`);
}

async function member(req: AuthenticatedRequest) {
  const user = await resolveUser(req.user!.sub);
  const access = await requirePlanWrite(user.id, getParam(req.params.planId));
  return { userId: user.id, access };
}

async function leader(req: AuthenticatedRequest) {
  const caller = await member(req);
  requirePlanRole(
    caller.access,
    ["leader"],
    say`Only a leader can change forms.`,
  );
  return caller;
}

/** Lock the form row for the rest of the transaction; 404 if not in the plan. */
async function lockForm(
  tx: Prisma.TransactionClient,
  planId: string,
  formId: string,
  mode: "update" | "share",
): Promise<void> {
  const rows =
    mode === "update"
      ? await tx.$queryRaw<unknown[]>`
          SELECT 1 FROM trip_plan_forms
          WHERE id = ${formId} AND plan_id = ${planId} FOR UPDATE`
      : await tx.$queryRaw<unknown[]>`
          SELECT 1 FROM trip_plan_forms
          WHERE id = ${formId} AND plan_id = ${planId} FOR SHARE`;
  if (rows.length === 0) throw formNotFound();
}

async function viewOf(formId: string, userId: string, access: PlanAccess) {
  const [form, statuses] = await Promise.all([
    prisma.tripPlanForm.findUniqueOrThrow({
      where: { id: formId },
      include: formInclude,
    }),
    memberStatuses(access.plan.id),
  ]);
  return formView(form, { userId, role: access.role }, statuses);
}

// ── POST /plans/:planId/forms ─────────────────────────────────
// Appended last.
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, access } = await leader(req);
    const planId = access.plan.id;
    const input = accepted(parseTripPlanFormCreate(req.body));
    const form = await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const [count, last] = await Promise.all([
        tx.tripPlanForm.count({ where: { planId } }),
        tx.tripPlanForm.findFirst({
          where: { planId },
          orderBy: { position: "desc" },
          select: { position: true },
        }),
      ]);
      if (count >= TRIP_PLAN_MAX_FORMS)
        throw new AppError(
          413,
          say`A plan can have up to ${TRIP_PLAN_MAX_FORMS} forms.`,
        );
      const row = await tx.tripPlanForm.create({
        data: { planId, ...input, position: (last?.position ?? -1) + 1 },
        select: { id: true },
      });
      return row;
    });
    res.status(201).json(await viewOf(form.id, userId, access));
  },
);

// ── PUT /plans/:planId/forms/order ────────────────────────────
// Body { ids }: every form exactly once, else 409 (someone added or deleted one).
router.put(
  "/order",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, access } = await leader(req);
    const planId = access.plan.id;
    const ids = accepted(parseTripPlanOrder(req.body, TRIP_PLAN_MAX_FORMS));
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const current = await tx.tripPlanForm.findMany({
        where: { planId },
        select: { id: true },
      });
      const stored = new Set(current.map((row) => row.id));
      if (stored.size !== ids.length || ids.some((id) => !stored.has(id)))
        throw new AppError(409, TRIP_PLAN_CHANGED_SENTENCE);
      for (const [position, id] of ids.entries())
        await tx.tripPlanForm.updateMany({
          where: { id, planId },
          data: { position },
        });
    });
    const [forms, statuses] = await Promise.all([
      prisma.tripPlanForm.findMany({
        where: { planId },
        include: formInclude,
        orderBy: [...ORDER],
      }),
      memberStatuses(planId),
    ]);
    const viewer = { userId, role: access.role };
    res.json({ forms: forms.map((form) => formView(form, viewer, statuses)) });
  },
);

// ── PATCH /plans/:planId/forms/:formId ────────────────────────
// Compare-and-set on each field sent. Changing questions keeps the answers;
// values for questions that went are left out when read.
router.patch(
  "/:formId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, access } = await leader(req);
    const planId = access.plan.id;
    const id = getParam(req.params.formId);
    const patch = accepted(parseTripPlanFormPatch(req.body));
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      await lockForm(tx, planId, id, "update");
      if (patch.visibleTo?.to === "members") {
        const form = await tx.tripPlanForm.findUniqueOrThrow({
          where: { id },
          select: { visibleTo: true },
        });
        const answeredByOthers =
          form.visibleTo !== "members" &&
          (await tx.tripPlanAnswer.count({
            where: { formId: id, userId: { not: userId } },
          })) > 0;
        if (answeredByOthers)
          throw new AppError(
            409,
            say`People answered this form for leaders only. Make a new form to share answers with everyone.`,
          );
      }
      const { count } = await tx.tripPlanForm.updateMany({
        where: {
          id,
          planId,
          ...(patch.title && { title: patch.title.from }),
          ...(patch.questions && {
            questions: {
              equals: patch.questions.from as Prisma.InputJsonValue,
            },
          }),
          ...(patch.visibleTo && { visibleTo: patch.visibleTo.from }),
          ...(patch.requiredToJoin && {
            requiredToJoin: patch.requiredToJoin.from,
          }),
        },
        data: {
          ...(patch.title && { title: patch.title.to }),
          ...(patch.questions && { questions: patch.questions.to }),
          ...(patch.visibleTo && { visibleTo: patch.visibleTo.to }),
          ...(patch.requiredToJoin && {
            requiredToJoin: patch.requiredToJoin.to,
          }),
        },
      });
      if (count === 0) throw new AppError(409, TRIP_PLAN_CHANGED_SENTENCE);
    });
    res.json(await viewOf(id, userId, access));
  },
);

// ── DELETE /plans/:planId/forms/:formId ───────────────────────
// Its answers go with it.
router.delete(
  "/:formId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { access } = await leader(req);
    const planId = access.plan.id;
    const id = getParam(req.params.formId);
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const { count } = await tx.tripPlanForm.deleteMany({
        where: { id, planId },
      });
      if (count === 0) throw formNotFound();
    });
    res.status(204).send();
  },
);

// ── PUT /plans/:planId/forms/:formId/answers/me ───────────────
// Body TripPlanAnswerPut { answers, visibleTo, formUpdatedAt }: the whole
// answer, replacing any before it, and the form as the person was shown it.
// Who sees the answers is checked first, so its own sentence wins.
router.put(
  "/:formId/answers/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, access } = await member(req);
    const planId = access.plan.id;
    const id = getParam(req.params.formId);
    const seen = req.body?.visibleTo;
    if (!isTripPlanFormVisibility(seen))
      throw malformed("visibleTo must be the visibility the form showed");
    const shown = req.body?.formUpdatedAt;
    if (typeof shown !== "string")
      throw malformed("formUpdatedAt must be the form's updatedAt as served");
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      await lockForm(tx, planId, id, "share");
      const form = await tx.tripPlanForm.findUniqueOrThrow({
        where: { id },
        select: { questions: true, visibleTo: true, updatedAt: true },
      });
      if (form.visibleTo !== seen)
        throw new AppError(409, TRIP_PLAN_VISIBILITY_CHANGED_SENTENCE);
      if (form.updatedAt.toISOString() !== shown)
        throw new AppError(409, TRIP_PLAN_FORM_CHANGED_SENTENCE);
      const parsed = parseTripPlanAnswers(
        form.questions as unknown as TripPlanQuestion[],
        req.body?.answers,
      );
      // The client was shown exactly these questions (formUpdatedAt matched),
      // so an answer that doesn't fit them is a broken client's, not a stale
      // one's: "this form changed" would be false, and a refetch would loop.
      // The parser keeps its 409 for its other callers (the join).
      if ("status" in parsed && parsed.status === 409)
        throw malformed("an answer doesn't fit the form it was shown");
      const answers = accepted(parsed);
      await tx.tripPlanAnswer.upsert({
        where: { formId_userId: { formId: id, userId } },
        create: { formId: id, userId, answers },
        update: { answers },
      });
    });
    const view = await viewOf(id, userId, access);
    res.json(view.myAnswer);
  },
);

// ── DELETE /plans/:planId/forms/:formId/answers/me ────────────
// Not for a form required to join: the answer is the price of being in.
router.delete(
  "/:formId/answers/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, access } = await member(req);
    const planId = access.plan.id;
    const id = getParam(req.params.formId);
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const form = await tx.tripPlanForm.findFirst({
        where: { id, planId },
        select: { requiredToJoin: true },
      });
      if (!form) throw formNotFound();
      if (form.requiredToJoin)
        throw new AppError(
          409,
          say`Everyone in this plan answers this form. To take your answer back, leave the plan.`,
        );
      await tx.tripPlanAnswer.deleteMany({ where: { formId: id, userId } });
    });
    res.status(204).send();
  },
);

export default router;
