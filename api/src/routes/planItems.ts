// A plan's places, routes and files: Add a place or way of something of
// yours, Save a copy of something in the plan, delete. Copy and storage
// rules are lib/planItems.ts's; access is lib/planAccess.ts's.
import { Router, Response } from "express";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import {
  asFieldValues,
  isTripPlanItemKind,
  parseRouteColor,
  parseTripPlanFilePatch,
  parseTripPlanItemAdd,
  parseTripPlanPlacePatch,
  parseTripPlanRoutePatch,
  say,
  TRIP_PLAN_CHANGED_SENTENCE,
  validateRoutePayload,
  type TripPlanItemKind,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { accepted, AppError, malformed } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  canChangeItem,
  requirePlanMember,
  requirePlanWrite,
  touchPlan,
} from "../lib/planAccess";
import {
  addPlanItem,
  copyStandaloneFile,
  deletePlanItem,
  itemNotFound,
  loadPlanItems,
} from "../lib/planItems";
import { toMediaItem } from "../lib/mediaPresign";
import { defsForPlaceType } from "../lib/placeTypes";
import {
  copyPlaceFor,
  placePayloadRefusal,
  validatePlaceTextFields,
} from "./places";
import { parseMediaDisplayName } from "./media";
import { copyRouteFor } from "./routes";

const router = Router({ mergeParams: true });

const NOT_YOURS = say`You can change what you added. A leader or an editor can change anything.`;

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
        : await prisma.media.findFirst({
            where: { ...where, linkedType: "none" },
          });
  if (!row) throw itemNotFound();
  return row;
}

// ── POST /plans/:planId/items ─────────────────────────────────
// Body { kind, id }: a copy of one of the caller's own things,
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
    const item = [...items.places, ...items.routes, ...items.files][0];
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
      throw new AppError(403, NOT_YOURS);
    await deletePlanItem(access.plan.id, kind, id);
    res.status(204).send();
  },
);

// ── PATCH /plans/:planId/items/:kind/:itemId ──────────────────
// Compare-and-set (below). Who may: as DELETE. The response is the item as
// GET /plans/:id shows it.
router.patch(
  "/:kind/:itemId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const access = await requirePlanWrite(user.id, getParam(req.params.planId));
    const kind = kindParam(req.params.kind);
    const id = getParam(req.params.itemId);
    const row = await planRow(access.plan.id, kind, id);
    if (!canChangeItem(access, row, user.id))
      throw new AppError(403, NOT_YOURS);
    await editPlanItem(access.plan.id, kind, row, req.body);
    // A delete can land between the edit's commit and this read.
    const items = await loadPlanItems(access.plan.id, { kind, id });
    const item = [...items.places, ...items.routes, ...items.files][0];
    if (!item) throw itemNotFound();
    res.json(item);
  },
);

// ── Compare-and-set edits ──────────────────────────────────────
// Editing a plan's places, routes and files: compare-and-set. A save sends,
// per field it changes, the value it last saw (`from`) and the new one
// (`to`); it lands only if every `from` is still what is stored, all or
// nothing, else 409 and the client refetches. A place's field values are
// compared per key, so two members writing different attributes both land.
//
// The compare and the write are one step because the transaction's first
// statement is touchPlan, which holds the plan's row until commit, and every
// write to a plan item takes it first (lib/planItems.ts). Comparing in code
// under that lock lets a value be compared as JSON, key order aside, where
// the column holds jsonb.
// Guard: api/src/__tests__/planItems.test.ts ("two saves from the same value").
//
// Each kind's patch is parsed in shared (parseTripPlanPlacePatch …); `to` is
// then validated as the owner's own routes validate it, a place's values
// against its system type's definitions.
function changed(): AppError {
  return new AppError(409, TRIP_PLAN_CHANGED_SENTENCE);
}

/** Run `apply` on the item's current row, under the plan's lock. */
async function underLock<Row>(
  planId: string,
  read: (tx: Prisma.TransactionClient) => Promise<Row | null>,
  apply: (tx: Prisma.TransactionClient, row: Row) => Promise<void>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await touchPlan(tx, planId);
    const row = await read(tx);
    if (!row) throw itemNotFound();
    await apply(tx, row);
  });
}

async function editPlace(
  planId: string,
  id: string,
  placeTypeId: string,
  body: unknown,
): Promise<void> {
  const edit = accepted(parseTripPlanPlacePatch(body));
  const defs = await defsForPlaceType(null, placeTypeId);
  // fieldValues is a pair per attribute written, each compared on its own.
  const valuePairs = Object.entries(edit.fieldValues ?? {});
  if (valuePairs.some(([key]) => !defs.some((def) => def.key === key)))
    throw malformed("a field can't be edited");
  const position = edit.position?.to;
  const payload = {
    name: edit.name?.to,
    altNames: edit.altNames?.to,
    notes: edit.notes?.to,
    elevation: edit.elevation?.to,
    latitude: position?.latitude,
    longitude: position?.longitude,
    fieldValues: Object.fromEntries(
      valuePairs.flatMap(([key, pair]) =>
        pair.to === null ? [] : [[key, pair.to]],
      ),
    ),
  };
  const refusal =
    placePayloadRefusal(payload, { requireCoords: !!position, defs }) ??
    validatePlaceTextFields(payload);
  if (refusal) throw refusal;

  await underLock(
    planId,
    (tx) => tx.place.findFirst({ where: { id, planId } }),
    async (tx, row) => {
      const stored: Record<string, unknown> = asFieldValues(row.fieldValues);
      const now = {
        name: row.name,
        altNames: row.altNames,
        position: { latitude: row.latitude, longitude: row.longitude },
        elevation: row.elevation,
        notes: row.notes,
      };
      for (const field of Object.keys(now) as (keyof typeof now)[]) {
        const pair = edit[field];
        if (pair && !isDeepStrictEqual(now[field], pair.from)) throw changed();
      }
      // An absent key and a null one are the same value.
      for (const [key, pair] of valuePairs)
        if (!isDeepStrictEqual(stored[key] ?? null, pair.from ?? null))
          throw changed();
      const fieldValues = { ...stored };
      for (const [key, pair] of valuePairs)
        if (pair.to === null) delete fieldValues[key];
        else fieldValues[key] = pair.to;
      await tx.place.update({
        where: { id },
        data: {
          ...(edit.name && { name: edit.name.to }),
          ...(edit.altNames && { altNames: edit.altNames.to }),
          ...(edit.notes && { notes: edit.notes.to }),
          ...(edit.elevation && { elevation: edit.elevation.to }),
          ...position,
          ...(valuePairs.length > 0 && {
            fieldValues: fieldValues as Prisma.InputJsonValue,
          }),
        },
      });
    },
  );
}

async function editRoute(
  planId: string,
  id: string,
  body: unknown,
): Promise<void> {
  const edit = accepted(parseTripPlanRoutePatch(body));
  const error = validateRoutePayload(
    { name: edit.name?.to },
    { requireCore: false },
  );
  if (error) throw malformed(error);
  const color = edit.color ? parseRouteColor(edit.color.to) : null;
  if (edit.color && color === null)
    throw malformed("color must be a palette colour");
  const geometry = edit.geometry;

  await underLock(
    planId,
    (tx) => tx.route.findFirst({ where: { id, planId } }),
    async (tx, row) => {
      if (edit.name && row.name !== edit.name.from) throw changed();
      if (edit.color && row.color !== edit.color.from) throw changed();
      // Geometry is its points and their anchors, null and absent alike.
      if (
        geometry &&
        !(
          isDeepStrictEqual(row.points, geometry.from.points) &&
          isDeepStrictEqual(row.anchors ?? null, geometry.from.anchors)
        )
      )
        throw changed();
      await tx.route.update({
        where: { id },
        data: {
          ...(edit.name && { name: edit.name.to.trim() }),
          ...(color && { color }),
          ...(geometry && {
            points: geometry.to.points,
            anchors: geometry.to.anchors ?? Prisma.DbNull,
          }),
        },
      });
    },
  );
}

async function editFile(planId: string, id: string, body: unknown) {
  const { from, to } = accepted(parseTripPlanFilePatch(body)).displayName!;
  const displayName = parseMediaDisplayName(to);
  await underLock(
    planId,
    (tx) => tx.media.findFirst({ where: { id, planId, linkedType: "none" } }),
    async (tx, row) => {
      if (row.displayName !== from) throw changed();
      await tx.media.update({ where: { id }, data: { displayName } });
    },
  );
}

/** Compare-and-set one item of the plan. */
async function editPlanItem(
  planId: string,
  kind: TripPlanItemKind,
  row: { id: string; placeTypeId?: string },
  body: unknown,
): Promise<void> {
  switch (kind) {
    case "place":
      return editPlace(planId, row.id, row.placeTypeId!, body);
    case "route":
      return editRoute(planId, row.id, body);
    case "media":
      return editFile(planId, row.id, body);
  }
}

export default router;
