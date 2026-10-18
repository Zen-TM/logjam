// A plan's forms and the answers members give them. Leaders build forms;
// every member answers for themselves, last write wins.
//
// WHO SEES AN ANSWER NEVER WIDENS AFTER IT WAS GIVEN (root AGENTS.md): a
// leader may turn a form from "everyone" to "leaders" at any time, but back
// only while no one else has answered; and an answer carries the visibility
// its author was shown, refused if it has changed since. The two lock the
// form row against each other, so neither can slip between the other's
// check and write. Reading answers is lib/tripPlanView.ts's `formView`.
// Guard: __tests__/planForms.test.ts.
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
  TRIP_PLAN_MAX_FORMS,
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
      await touchPlan(tx, planId);
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
      const current = await tx.tripPlanForm.findMany({
        where: { planId },
        select: { id: true },
      });
      const stored = new Set(current.map((row) => row.id));
      if (stored.size !== ids.length || ids.some((id) => !stored.has(id)))
        throw new AppError(409, TRIP_PLAN_CHANGED_SENTENCE);
      await Promise.all(
        ids.map((id, position) =>
          tx.tripPlanForm.update({ where: { id }, data: { position } }),
        ),
      );
      await touchPlan(tx, planId);
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
      await touchPlan(tx, planId);
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
      const { count } = await tx.tripPlanForm.deleteMany({
        where: { id, planId },
      });
      if (count === 0) throw formNotFound();
      await touchPlan(tx, planId);
    });
    res.status(204).send();
  },
);

// ── PUT /plans/:planId/forms/:formId/answers/me ───────────────
// Body { answers, visibleTo }: the whole answer, replacing any before it, and
// who the form said would see it.
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
    await prisma.$transaction(async (tx) => {
      await lockForm(tx, planId, id, "share");
      const form = await tx.tripPlanForm.findUniqueOrThrow({
        where: { id },
        select: { questions: true, visibleTo: true },
      });
      if (form.visibleTo !== seen)
        throw new AppError(
          409,
          say`Who sees the answers to this form has changed. Check it, then answer again.`,
        );
      const answers = accepted(
        parseTripPlanAnswers(
          form.questions as unknown as TripPlanQuestion[],
          req.body?.answers,
        ),
      );
      await tx.tripPlanAnswer.upsert({
        where: { formId_userId: { formId: id, userId } },
        create: { formId: id, userId, answers },
        update: { answers },
      });
      await touchPlan(tx, planId);
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
      await touchPlan(tx, planId);
    });
    res.status(204).send();
  },
);

export default router;
