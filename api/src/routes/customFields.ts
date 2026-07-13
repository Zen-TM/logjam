import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  normalizeUserUiPreferences,
  tripLogHasCustomFieldValue,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { userPatchLimiter } from "../middleware/rateLimit";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";
import { getParam } from "../lib/getParam";

const router = Router();

// Custom field management (account-level), for BOTH trip-log and canyon fields.
// Field DEFINITIONS live in User.uiPreferences (tripLogCustomFields /
// canyonCustomFields); the VALUES live keyed by the field's `key` on the owning
// rows — TripLog.customFields (top-level JSON object) and, for canyons, nested
// under Canyon.attributes.customFields.
//
// - Rename keeps the `key` stable (done via PATCH /users/me), so stored values
//   stay linked — no endpoint needed here.
// - Delete must both drop the definition AND strip the now-orphaned values from
//   every row that carried one, transactionally. Preserving the values would
//   leave them to silently resurface if a later field slugged to the same key
//   (and, for canyons, would leak the orphaned values into exports), so we
//   remove them and report the count.
//
// The two entities differ only in where the values live and how a stripped row
// is rebuilt; that difference is isolated in the `entityConfigs` below so the
// impact/delete handlers stay single-sourced.

function isJsonObject(
  value: Prisma.JsonValue | null | undefined,
): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Extract the customFields record from a canyon's attributes blob, or null when
// the canyon has no custom-field values at all. Exported for unit testing.
export function canyonCustomFieldsRecord(
  attributes: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (!isJsonObject(attributes)) return null;
  const customFields = attributes.customFields;
  return isJsonObject(customFields)
    ? (customFields as Record<string, unknown>)
    : null;
}

// Per-entity config isolating the storage-shape differences. `Row` is the
// narrow row loaded for counting/stripping; `extractFields` pulls the value
// record out of it, and `stripUpdate` builds the Prisma update that removes the
// key while preserving everything else (e.g. a canyon's `sources`).
type EntityConfig<Row> = {
  segment: "trip-log" | "canyon";
  defsKey: "tripLogCustomFields" | "canyonCustomFields";
  // Response field names, kept entity-specific to match the existing trip-log
  // contract (tripLogCount / removedFromTripCount).
  countResponseKey: string;
  removedResponseKey: string;
  loadRows: (userId: string) => Promise<Row[]>;
  extractFields: (row: Row) => Record<string, unknown> | null;
  stripUpdate: (row: Row, key: string) => Prisma.PrismaPromise<unknown>;
};

type TripLogRow = { id: string; customFields: Prisma.JsonValue };
type CanyonRow = { id: string; attributes: Prisma.JsonValue };

const tripLogEntity: EntityConfig<TripLogRow> = {
  segment: "trip-log",
  defsKey: "tripLogCustomFields",
  countResponseKey: "tripLogCount",
  removedResponseKey: "removedFromTripCount",
  loadRows: (userId) =>
    prisma.tripLog.findMany({
      where: { userId },
      select: { id: true, customFields: true },
    }),
  extractFields: (row) =>
    isJsonObject(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : null,
  stripUpdate: (row, key) => {
    const next = { ...(row.customFields as Prisma.JsonObject) };
    delete next[key];
    return prisma.tripLog.update({
      where: { id: row.id },
      data: { customFields: next },
    });
  },
};

const canyonEntity: EntityConfig<CanyonRow> = {
  segment: "canyon",
  defsKey: "canyonCustomFields",
  countResponseKey: "canyonCount",
  removedResponseKey: "removedFromCanyonCount",
  loadRows: (userId) =>
    prisma.canyon.findMany({
      where: { ownerId: userId },
      select: { id: true, attributes: true },
    }),
  extractFields: (row) => canyonCustomFieldsRecord(row.attributes),
  stripUpdate: (row, key) => {
    // Preserve every other attribute (notably `sources`) — only the one
    // customFields entry is removed.
    const attributes = isJsonObject(row.attributes) ? row.attributes : {};
    const nextFields = { ...(canyonCustomFieldsRecord(row.attributes) ?? {}) };
    delete nextFields[key];
    return prisma.canyon.update({
      where: { id: row.id },
      data: {
        attributes: {
          ...attributes,
          customFields: nextFields,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  },
};

// Rows that actually carry a meaningful value for `key` — the only rows a
// delete needs to rewrite, and the population an impact count reports.
function rowsWithValue<Row>(
  entity: EntityConfig<Row>,
  rows: Row[],
  key: string,
): Row[] {
  return rows.filter((row) => {
    const fields = entity.extractFields(row);
    return fields ? tripLogHasCustomFieldValue(fields, key) : false;
  });
}

function requireFieldExists(
  defs: TripLogCustomFieldDef[],
  key: string,
): void {
  if (!defs.some((d) => d.key === key)) {
    throw new AppError(404, "Custom field not found");
  }
}

// GET /custom-fields/:entity/:key/impact — how many of the user's rows carry a
// value for this field. Shown before a rename/delete is confirmed.
async function handleImpact<Row>(
  entity: EntityConfig<Row>,
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const user = await resolveUser(req.user!.sub);
  const key = getParam(req.params.key);

  const prefs = normalizeUserUiPreferences(user.uiPreferences);
  requireFieldExists(prefs[entity.defsKey] ?? [], key);

  const rows = await entity.loadRows(user.id);
  const count = rowsWithValue(entity, rows, key).length;

  res.json({ [entity.countResponseKey]: count });
}

// DELETE /custom-fields/:entity/:key — remove the field definition and strip its
// value from every row that carried one. Returns the surviving field
// definitions and the number of rows whose value was removed.
async function handleDelete<Row>(
  entity: EntityConfig<Row>,
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const user = await resolveUser(req.user!.sub);
  const key = getParam(req.params.key);

  const prefs = normalizeUserUiPreferences(user.uiPreferences);
  const currentDefs = prefs[entity.defsKey] ?? [];
  requireFieldExists(currentDefs, key);
  const remainingDefs = currentDefs.filter((d) => d.key !== key);

  const rows = await entity.loadRows(user.id);
  const affected = rowsWithValue(entity, rows, key);

  await prisma.$transaction([
    ...affected.map((row) => entity.stripUpdate(row, key)),
    prisma.user.update({
      where: { id: user.id },
      data: {
        uiPreferences: {
          ...prefs,
          [entity.defsKey]: remainingDefs,
        } as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  res.json({
    [entity.defsKey]: remainingDefs,
    [entity.removedResponseKey]: affected.length,
  });
}

router.get(
  "/trip-log/:key/impact",
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => handleImpact(tripLogEntity, req, res),
);

router.delete(
  "/trip-log/:key",
  requireAuth,
  // Same budget as PATCH /users/me — this mutates the same preference blob
  // (plus entity rows), and the rename path already goes through that limiter.
  userPatchLimiter,
  (req: AuthenticatedRequest, res: Response) => handleDelete(tripLogEntity, req, res),
);

router.get(
  "/canyon/:key/impact",
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => handleImpact(canyonEntity, req, res),
);

router.delete(
  "/canyon/:key",
  requireAuth,
  userPatchLimiter,
  (req: AuthenticatedRequest, res: Response) => handleDelete(canyonEntity, req, res),
);

export default router;
