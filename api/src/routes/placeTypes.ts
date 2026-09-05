// Place type management (account-level).
//
// A type is a category of place, carrying the field definitions scoped to it.
// The write paths here are thin: every rule lives in `lib/placeTypes.ts` so the
// sync push handler enforces the identical thing — a rule applied on one path
// and not the other holds only until someone uses the other client.
//
// SYSTEM TYPES (ownerId null) are readable by everyone and writable by no one.
// They are global rows rather than per-user copies, which is what makes a
// shared or copied place of a system type resolve for its recipient with no
// reconciliation at all.
//
// PRIVACY: a type's name is user-authored text. Nothing here logs one.
import { Router, Response } from "express";

import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { userPatchLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";
import { getParam } from "../lib/getParam";
import prisma from "../services/prisma";
import {
  assertValidPlaceType,
  createPlaceType,
  deletePlaceType,
  requireOwnPlaceType,
  visiblePlaceTypeWhere,
} from "../lib/placeTypes";
import { placeTypeDeleteTombstones, writeTombstones } from "../lib/syncTombstones";

const router = Router();

// GET /place-types — the types this user can put a place into, system first.
//
// Carries `placeCount` because the clients need it for TWO rules that would
// otherwise each cost a query per type: a type with zero places is hidden from
// the tab bar and the map layers panel (but ALWAYS offered in the create-a-place
// picker, or you could never make your first canyon), and a type with places in
// it cannot be deleted.
//
// This is the owner's own count over their own places, so it is not the
// owner-private-aggregate case — there is no sharee who can reach this route.
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const types = await prisma.placeType.findMany({
      where: visiblePlaceTypeWhere(user.id),
      orderBy: [{ ownerId: "asc" }, { position: "asc" }, { name: "asc" }],
    });
    const counts = await prisma.place.groupBy({
      by: ["placeTypeId"],
      where: { ownerId: user.id },
      _count: { _all: true },
    });
    const countByType = new Map(
      counts.map((row) => [row.placeTypeId, row._count._all]),
    );
    res.json({
      types: types.map((type) => ({
        ...type,
        isSystem: type.ownerId === null,
        placeCount: countByType.get(type.id) ?? 0,
      })),
    });
  },
);

// POST /place-types — create one.
router.post(
  "/",
  requireAuth,
  userPatchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const input = assertValidPlaceType(req.body ?? {});
    const type = await createPlaceType(user.id, undefined, input);
    res.status(201).json(type);
  },
);

// PATCH /place-types/:id — rename, re-icon, re-colour, reorder.
router.patch(
  "/:id",
  requireAuth,
  userPatchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const id = getParam(req.params.id);
    const current = await requireOwnPlaceType(user.id, id);
    // Validate the RESULT, not the patch: a patch that only moves `color` must
    // still leave a type whose icon and colour are both in the curated lists.
    const merged = assertValidPlaceType({
      name: req.body?.name ?? current.name,
      iconKey: req.body?.iconKey ?? current.iconKey,
      color: req.body?.color ?? current.color,
      position: req.body?.position ?? current.position,
    });
    res.json(await prisma.placeType.update({ where: { id }, data: merged }));
  },
);

// DELETE /place-types/:id
//
// 409 while the type still holds places, with the count, so the client can
// offer a reassign. A type is a CATEGORY: deleting one must never delete what
// is in it, and cascading would do exactly that.
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const id = getParam(req.params.id);
    const result = await deletePlaceType(user.id, id);
    if (!result.ok) {
      throw new AppError(
        409,
        `That type still has ${result.placeCount} place${result.placeCount === 1 ? "" : "s"} in it. Move them to another type first.`,
      );
    }
    await writeTombstones(
      prisma,
      placeTypeDeleteTombstones({ ownerId: user.id, placeTypeId: id }),
    );
    res.json({ removedFieldCount: result.removedDefs });
  },
);

// POST /place-types/:id/reassign — move every place of this type to another.
//
// The escape hatch the 409 above points at, and the reason delete does not
// cascade. Both types must be ones the caller may use; the target may be a
// system type, which is how "I miscategorised these, they are just markers"
// resolves.
router.post(
  "/:id/reassign",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const from = getParam(req.params.id);
    const to = typeof req.body?.placeTypeId === "string" ? req.body.placeTypeId : "";
    if (!to || to === from) throw new AppError(400, "A different placeTypeId is required");

    const [source, target] = await Promise.all([
      prisma.placeType.findFirst({ where: { id: from, ...visiblePlaceTypeWhere(user.id) } }),
      prisma.placeType.findFirst({ where: { id: to, ...visiblePlaceTypeWhere(user.id) } }),
    ]);
    if (!source || !target) throw new AppError(404, "Place type not found");

    // Values the new type does not carry are NOT destroyed — they stay in
    // `fieldValues`, which the "render any key that already has a value" rule
    // keeps visible. Phase 4 moves them into `foreignFields` so they read as
    // what they are.
    const { count } = await prisma.place.updateMany({
      where: { ownerId: user.id, placeTypeId: from },
      data: { placeTypeId: to },
    });
    res.json({ movedCount: count });
  },
);

export default router;
