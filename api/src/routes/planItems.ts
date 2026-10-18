// A plan's places, routes, files and GeoPDFs: Add a copy of something of
// yours, Save a copy of something in the plan, delete. Copy and storage
// rules are lib/planItems.ts's; access is lib/planAccess.ts's.
import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  asFieldValues,
  isTripPlanItemKind,
  parseRouteColor,
  parseRoutePoints,
  parseTripPlanItemAdd,
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
  copyGeoPdf,
  copyStandaloneFile,
  deletePlanItem,
  itemNotFound,
  loadPlanItems,
} from "../lib/planItems";
import { toMediaItem } from "../lib/mediaPresign";
import { geoPdfDownloadFilename, presignResult } from "../lib/geoPdfResult";
import { defsForPlaceType } from "../lib/placeTypes";
import { parseAnchorsOrNull } from "../lib/routeLink";
import {
  copyPlaceFor,
  placePayloadRefusal,
  validatePlaceTextFields,
} from "./places";
import { parseMediaDisplayName } from "./media";
import { copyRouteFor } from "./routes";
import { rowToView } from "./geoPdf";

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
    const items = await loadPlanItems(access.plan.id, { kind, id });
    res.json(
      [...items.places, ...items.routes, ...items.files, ...items.geoPdfs][0],
    );
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
// Guard: __tests__/planItems.test.ts ("compare-and-set").
//
// `to` is validated as the owner's own routes validate it, a place's values
// against its system type's definitions.
type Pair = { from: unknown; to: unknown };

/** JSON equality, object key order aside (jsonb reorders keys). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) =>
        sameJson(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
      )
    );
  }
  return false;
}

/**
 * The body's pairs, by field: only `fields`, each `{from, to}`, and at least
 * one unless `optional`.
 */
function pairs(
  body: unknown,
  fields: readonly string[],
  optional = false,
): Map<string, Pair> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw malformed("body must be an object");
  const out = new Map<string, Pair>();
  for (const [field, value] of Object.entries(body)) {
    if (!fields.includes(field)) throw malformed("a field can't be edited");
    if (
      !value ||
      typeof value !== "object" ||
      !("from" in value) ||
      !("to" in value)
    )
      throw malformed("a field needs from and to");
    out.set(field, { from: value.from, to: value.to });
  }
  if (out.size === 0 && !optional) throw malformed("the patch changes nothing");
  return out;
}

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

const PLACE_FIELDS = ["name", "altNames", "position", "elevation", "notes"];

async function editPlace(
  planId: string,
  id: string,
  placeTypeId: string,
  body: unknown,
): Promise<void> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw malformed("body must be an object");
  // fieldValues is { key: {from, to} }: a pair per attribute written, each
  // compared on its own.
  const { fieldValues: rawValues, ...rest } = body as Record<string, unknown>;
  const edit = pairs(rest, PLACE_FIELDS, rawValues !== undefined);
  const defs = await defsForPlaceType(null, placeTypeId);
  const valuePairs =
    rawValues === undefined
      ? new Map<string, Pair>()
      : pairs(
          rawValues,
          defs.map((def) => def.key),
        );
  const to = (field: string) => edit.get(field)?.to;
  const position = to("position") as
    | { latitude?: unknown; longitude?: unknown }
    | undefined;
  if (edit.has("position") && (!position || typeof position !== "object"))
    throw malformed("position.to must be an object");
  const payload = {
    name: to("name"),
    altNames: to("altNames"),
    notes: to("notes"),
    elevation: to("elevation"),
    latitude: position?.latitude,
    longitude: position?.longitude,
    fieldValues: Object.fromEntries(
      [...valuePairs].flatMap(([key, pair]) =>
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
      const stored = asFieldValues(row.fieldValues);
      const now: Record<string, unknown> = {
        name: row.name,
        altNames: row.altNames,
        position: { latitude: row.latitude, longitude: row.longitude },
        elevation: row.elevation,
        notes: row.notes,
      };
      for (const [field, pair] of edit)
        if (!sameJson(now[field], pair.from)) throw changed();
      // An absent key and a null one are the same value.
      for (const [key, pair] of valuePairs)
        if (!sameJson(stored[key] ?? null, pair.from ?? null)) throw changed();
      const fieldValues = { ...stored };
      for (const [key, pair] of valuePairs)
        if (pair.to === null) delete fieldValues[key];
        else fieldValues[key] = pair.to;
      await tx.place.update({
        where: { id },
        data: {
          ...(edit.has("name") && { name: payload.name as string }),
          ...(edit.has("altNames") && {
            altNames: (payload.altNames as string[] | null) ?? [],
          }),
          ...(edit.has("notes") && { notes: payload.notes as string | null }),
          ...(edit.has("elevation") && {
            elevation: payload.elevation as number | null,
          }),
          ...(position && {
            latitude: payload.latitude as number,
            longitude: payload.longitude as number,
          }),
          ...(valuePairs.size > 0 && {
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
  const edit = pairs(body, ["name", "color", "geometry"]);
  const geometry = edit.get("geometry")?.to as
    | { points?: unknown; anchors?: unknown }
    | undefined;
  if (edit.has("geometry") && (!geometry || typeof geometry !== "object"))
    throw malformed("geometry.to must be an object");
  const error = validateRoutePayload(
    {
      name: edit.get("name")?.to,
      points: geometry?.points,
      anchors: geometry?.anchors,
    },
    { requireCore: false },
  );
  if (error) throw malformed(error);
  const color = edit.has("color")
    ? parseRouteColor(edit.get("color")!.to)
    : null;
  if (edit.has("color") && color === null)
    throw malformed("color must be a palette colour");
  const parsed = geometry ? parseRoutePoints(geometry.points) : null;
  const points = parsed && "points" in parsed ? parsed.points : undefined;

  await underLock(
    planId,
    (tx) => tx.route.findFirst({ where: { id, planId } }),
    async (tx, row) => {
      const now: Record<string, unknown> = { name: row.name, color: row.color };
      for (const [field, pair] of edit) {
        // Geometry is its points and their anchors, null and absent alike.
        const from = pair.from as { points?: unknown; anchors?: unknown };
        const same =
          field === "geometry"
            ? !!from &&
              sameJson(row.points, from.points) &&
              sameJson(row.anchors ?? null, from.anchors ?? null)
            : sameJson(now[field], pair.from);
        if (!same) throw changed();
      }
      await tx.route.update({
        where: { id },
        data: {
          ...(edit.has("name") && {
            name: (edit.get("name")!.to as string).trim(),
          }),
          ...(color && { color }),
          ...(points && {
            points,
            anchors: parseAnchorsOrNull(geometry!.anchors, points.length),
          }),
        },
      });
    },
  );
}

async function editFile(planId: string, id: string, body: unknown) {
  const edit = pairs(body, ["displayName"]);
  const pair = edit.get("displayName")!;
  const displayName = parseMediaDisplayName(pair.to);
  if (pair.from !== null && typeof pair.from !== "string")
    throw malformed("displayName.from must be a string or null");
  await underLock(
    planId,
    (tx) => tx.media.findFirst({ where: { id, planId, linkedType: "none" } }),
    async (tx, row) => {
      if (row.displayName !== pair.from) throw changed();
      await tx.media.update({ where: { id }, data: { displayName } });
    },
  );
}

/**
 * Compare-and-set one item of the plan. A GeoPDF has nothing to edit: its
 * map is fixed when it is made.
 */
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
    case "geoPdf":
      throw malformed("a GeoPDF can't be edited");
  }
}

export default router;
