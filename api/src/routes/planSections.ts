// A plan's write-up: titled sections of plain text, in order. Leaders and
// editors write them. Every write starts its transaction with touchPlan
// (lib/planAccess.ts), which moves the plan's `updatedAt` and locks its row,
// so the cap, the positions and the order check see one write at a time.
import { Router, Response } from "express";
import {
  parseTripPlanOrder,
  parseTripPlanSectionCreate,
  parseTripPlanSectionPatch,
  say,
  TRIP_PLAN_CHANGED_SENTENCE,
  TRIP_PLAN_MAX_SECTIONS,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { accepted, AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  requirePlanRole,
  requirePlanWrite,
  touchPlan,
} from "../lib/planAccess";
import { sectionView } from "../lib/tripPlanView";

const router = Router({ mergeParams: true });

const FORBIDDEN = say`Only a leader or an editor can change the write-up.`;
const ORDER = [{ position: "asc" }, { createdAt: "asc" }] as const;

function sectionNotFound(): AppError {
  return new AppError(404, say`Couldn't find that.`);
}

async function writer(req: AuthenticatedRequest) {
  const user = await resolveUser(req.user!.sub);
  const access = await requirePlanWrite(user.id, getParam(req.params.planId));
  requirePlanRole(access, ["leader", "editor"], FORBIDDEN);
  return access.plan.id;
}

// ── POST /plans/:planId/sections ──────────────────────────────
// Appended last.
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const planId = await writer(req);
    const input = accepted(parseTripPlanSectionCreate(req.body));
    const section = await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const [count, last] = await Promise.all([
        tx.tripPlanSection.count({ where: { planId } }),
        tx.tripPlanSection.findFirst({
          where: { planId },
          orderBy: { position: "desc" },
          select: { position: true },
        }),
      ]);
      if (count >= TRIP_PLAN_MAX_SECTIONS)
        throw new AppError(
          413,
          say`A plan can have up to ${TRIP_PLAN_MAX_SECTIONS} sections.`,
        );
      const row = await tx.tripPlanSection.create({
        data: { planId, ...input, position: (last?.position ?? -1) + 1 },
      });
      return row;
    });
    res.status(201).json(sectionView(section));
  },
);

// ── PUT /plans/:planId/sections/order ─────────────────────────
// Body { ids }: every section exactly once. A different set means someone
// added or deleted one meanwhile: 409, and the client refetches.
router.put(
  "/order",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const planId = await writer(req);
    const ids = accepted(parseTripPlanOrder(req.body, TRIP_PLAN_MAX_SECTIONS));
    const sections = await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const current = await tx.tripPlanSection.findMany({
        where: { planId },
        select: { id: true },
      });
      const stored = new Set(current.map((row) => row.id));
      if (stored.size !== ids.length || ids.some((id) => !stored.has(id)))
        throw new AppError(409, TRIP_PLAN_CHANGED_SENTENCE);
      for (const [position, id] of ids.entries())
        await tx.tripPlanSection.updateMany({
          where: { id, planId },
          data: { position },
        });
      return tx.tripPlanSection.findMany({
        where: { planId },
        orderBy: [...ORDER],
      });
    });
    res.json({ sections: sections.map(sectionView) });
  },
);

// ── PATCH /plans/:planId/sections/:sectionId ──────────────────
// Compare-and-set on title and body, each on its own.
router.patch(
  "/:sectionId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const planId = await writer(req);
    const id = getParam(req.params.sectionId);
    const patch = accepted(parseTripPlanSectionPatch(req.body));
    const section = await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const { count } = await tx.tripPlanSection.updateMany({
        where: {
          id,
          planId,
          ...(patch.title && { title: patch.title.from }),
          ...(patch.body && { body: patch.body.from }),
        },
        data: {
          ...(patch.title && { title: patch.title.to }),
          ...(patch.body && { body: patch.body.to }),
        },
      });
      const row = await tx.tripPlanSection.findFirst({ where: { id, planId } });
      if (!row) throw sectionNotFound();
      if (count === 0) throw new AppError(409, TRIP_PLAN_CHANGED_SENTENCE);
      return row;
    });
    res.json(sectionView(section));
  },
);

// ── DELETE /plans/:planId/sections/:sectionId ─────────────────
router.delete(
  "/:sectionId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const planId = await writer(req);
    const id = getParam(req.params.sectionId);
    await prisma.$transaction(async (tx) => {
      await touchPlan(tx, planId);
      const { count } = await tx.tripPlanSection.deleteMany({
        where: { id, planId },
      });
      if (count === 0) throw sectionNotFound();
    });
    res.status(204).send();
  },
);

export default router;
