// A plan's places, routes, files and GeoPDFs: Add a copy of something of
// yours, Save a copy of something in the plan, delete. Copy and storage
// rules are lib/planItems.ts's; access is lib/planAccess.ts's.
import { Router, Response } from "express";
import {
  isTripPlanItemKind,
  parseTripPlanItemAdd,
  say,
  type TripPlanItemKind,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { accepted, AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  canChangeItem,
  requirePlanMember,
  requirePlanWrite,
} from "../lib/planAccess";
import {
  addPlanItem,
  copyGeoPdf,
  copyStandaloneFile,
  deletePlanItem,
  itemNotFound,
  loadPlanItems,
} from "../lib/planItems";
import { toMediaItem } from "../lib/mediaPresign";
import { geoPdfDownloadFilename, presignResult } from "../lib/geoPdfResult";
import { copyPlaceFor } from "./places";
import { copyRouteFor } from "./routes";
import { rowToView } from "./geoPdf";

const router = Router({ mergeParams: true });

/** The item kind in a path; anything else is an item that isn't there. */
function kindParam(value: unknown): TripPlanItemKind {
  const kind = getParam(value as string);
  if (!isTripPlanItemKind(kind)) throw itemNotFound();
  return kind;
}

/** The plan row of `kind` with this id, or 404. */
async function planRow(planId: string, kind: TripPlanItemKind, id: string) {
  const where = { id, planId };
  const row =
    kind === "place"
      ? await prisma.place.findFirst({ where })
      : kind === "route"
        ? await prisma.route.findFirst({ where })
        : kind === "media"
          ? await prisma.media.findFirst({
              where: { ...where, linkedType: "none" },
            })
          : await prisma.geoPdfJob.findFirst({ where });
  if (!row) throw itemNotFound();
  return row;
}

// ── POST /plans/:planId/items ─────────────────────────────────
// Body { kind, id, copyMedia? }: a copy of one of the caller's own things,
// charged to them. The response is the new item as GET /plans/:id shows it.
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanWrite(user.id, getParam(req.params.planId));
    const input = accepted(parseTripPlanItemAdd(req.body));
    const added = await addPlanItem(user, access.plan.id, input);
    const items = await loadPlanItems(access.plan.id, {
      kind: input.kind,
      id: added.id,
    });
    const item = [
      ...items.places,
      ...items.routes,
      ...items.files,
      ...items.geoPdfs,
    ][0];
    if (!item) throw itemNotFound();
    res.status(201).json({
      item,
      ...(added.media && {
        mediaCopied: added.media.copied,
        mediaSkipped: added.media.skipped,
        ...(added.media.outOfSpace && { mediaOutOfSpace: true }),
      }),
    });
  },
);

// ── POST /plans/:planId/items/:kind/:itemId/save ──────────────
// Save a copy: the caller's own copy, charged to them, in the shape the
// kind's own copy route answers with. Works on an archived plan.
router.post(
  "/:kind/:itemId/save",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanMember(
      user.id,
      getParam(req.params.planId),
    );
    const kind = kindParam(req.params.kind);
    const id = getParam(req.params.itemId);
    switch (kind) {
      case "place": {
        const place = await prisma.place.findFirst({
          where: { id, planId: access.plan.id },
        });
        if (!place) throw itemNotFound();
        res.status(201).json(await copyPlaceFor(user, place, req.body));
        return;
      }
      case "route": {
        const route = await prisma.route.findFirst({
          where: { id, planId: access.plan.id },
        });
        if (!route) throw itemNotFound();
        res.status(201).json(await copyRouteFor(user.id, route));
        return;
      }
      case "media": {
        const file = await prisma.media.findFirst({
          where: { id, planId: access.plan.id, linkedType: "none" },
        });
        if (!file) throw itemNotFound();
        const row = await copyStandaloneFile(file, user.id, {
          ownerId: user.id,
        });
        res.status(201).json(await toMediaItem(row));
        return;
      }
      case "geoPdf": {
        const job = await prisma.geoPdfJob.findFirst({
          where: { id, planId: access.plan.id },
        });
        if (!job) throw itemNotFound();
        const row = await copyGeoPdf(job, user.id, { ownerId: user.id });
        const download = await presignResult(
          row.resultKey,
          geoPdfDownloadFilename(row.config, row.createdAt),
        );
        res.status(201).json(rowToView(row, download, user.id));
        return;
      }
    }
  },
);

// ── DELETE /plans/:planId/items/:kind/:itemId ─────────────────
// A member deletes what they added; a leader or an editor anything. A file
// refunds whoever it counts against.
router.delete(
  "/:kind/:itemId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanWrite(user.id, getParam(req.params.planId));
    const kind = kindParam(req.params.kind);
    const id = getParam(req.params.itemId);
    const row = await planRow(access.plan.id, kind, id);
    if (!canChangeItem(access, row, user.id))
      throw new AppError(
        403,
        say`You can change what you added. A leader or an editor can change anything.`,
      );
    await deletePlanItem(access.plan.id, kind, id);
    res.status(204).send();
  },
);

export default router;
