import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  normalizeUserUiPreferences,
  tripLogHasCustomFieldValue,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { userPatchLimiter } from "../middleware/rateLimit";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";
import { getParam } from "../lib/getParam";

const router = Router();

// Custom trip-log field management (account-level). Field DEFINITIONS live in
// User.uiPreferences.tripLogCustomFields; the VALUES live in TripLog.customFields
// keyed by the field's `key`.
//
// - Rename keeps the `key` stable (done via PATCH /users/me), so stored values
//   stay linked — no endpoint needed here.
// - Delete must both drop the definition AND strip the now-orphaned values from
//   every trip that carried one, transactionally. Preserving the values would
//   leave them to silently resurface if a later field slugged to the same key,
//   so we remove them and report the count.

function isTripLogCustomFields(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// GET /custom-fields/trip-log/:key/impact — how many of the user's trip logs
// carry a value for this field. Shown before a rename/delete is confirmed.
router.get(
  "/trip-log/:key/impact",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const key = getParam(req.params.key);

    const prefs = normalizeUserUiPreferences(user.uiPreferences);
    const exists = (prefs.tripLogCustomFields ?? []).some((d) => d.key === key);
    if (!exists) throw new AppError(404, "Custom field not found");

    const trips = await prisma.tripLog.findMany({
      where: { userId: user.id },
      select: { customFields: true },
    });
    const tripLogCount = trips.filter((t) =>
      isTripLogCustomFields(t.customFields)
        ? tripLogHasCustomFieldValue(t.customFields as Record<string, unknown>, key)
        : false,
    ).length;

    res.json({ tripLogCount });
  },
);

// DELETE /custom-fields/trip-log/:key — remove the field definition and strip
// its value from every trip log that carried one. Returns the surviving field
// definitions and the number of trips whose value was removed.
router.delete(
  "/trip-log/:key",
  requireAuth,
  // Same budget as PATCH /users/me — this mutates the same preference blob
  // (plus trip rows), and the rename path already goes through that limiter.
  userPatchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const key = getParam(req.params.key);

    const prefs = normalizeUserUiPreferences(user.uiPreferences);
    const currentDefs = prefs.tripLogCustomFields ?? [];
    if (!currentDefs.some((d) => d.key === key)) {
      throw new AppError(404, "Custom field not found");
    }
    const remainingDefs = currentDefs.filter((d) => d.key !== key);

    // Find the trips that actually carry a value for this key so we only rewrite
    // rows that change (and can report an accurate count).
    const trips = await prisma.tripLog.findMany({
      where: { userId: user.id },
      select: { id: true, customFields: true },
    });
    const affected = trips.filter((t) =>
      isTripLogCustomFields(t.customFields)
        ? tripLogHasCustomFieldValue(t.customFields as Record<string, unknown>, key)
        : false,
    );

    await prisma.$transaction([
      ...affected.map((t) => {
        const next = { ...(t.customFields as Prisma.JsonObject) };
        delete next[key];
        return prisma.tripLog.update({
          where: { id: t.id },
          data: { customFields: next },
        });
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          uiPreferences: {
            ...prefs,
            tripLogCustomFields: remainingDefs,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    res.json({
      tripLogCustomFields: remainingDefs,
      removedFromTripCount: affected.length,
    });
  },
);

export default router;
