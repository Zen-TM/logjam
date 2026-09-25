// Custom field management (account-level), for BOTH trip-log and place fields.
//
// Row-grain REST over `lib/customFieldDefs.ts`, which owns every write and the
// value strip a delete carries. This router holds no storage knowledge — it
// parses, authorizes and shapes responses.
//
// ONE write surface, and this is it: here and the sync push handler, addressing
// ONE definition at a time. That grain is what lets a phone edit offline and
// merge rather than clobber.
//
// `PATCH /users/me` used to accept a whole list as well. It does not any more
// and must not come back: that shape carries no `placeTypeIds` and no
// `appliesToAllTypes`, so every save from a dialog that round-tripped the list
// wiped the scoping off every definition — silently, because the payload simply
// did not mention it. `routes/users.ts` answers it with a 400 naming the
// replacement, and `__tests__/customFields.test.ts` pins that refusal.
//
// The impact/delete response key names (`tripLogCount`, `removedFromTripCount`
// and their place equivalents) predate this rewrite and are kept verbatim —
// `frontend/src/placeUtils.ts` reads them by name.
//
// PRIVACY: labels are user-authored text. Nothing here logs one.
import { Router, Response } from "express";
import { type CustomFieldEntity } from "@logjam/shared";

import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { userPatchLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";
import { getParam } from "../lib/getParam";
import { parseTripTypes } from "./tripLogsGlobal";
import {
  assertValidDef,
  countRowsWithValue,
  createFieldDef,
  deleteFieldDefByKey,
  entityConfig,
  findDefIdByKey,
  loadDefs,
  loadScopedDefs,
  updateFieldDef,
  ENTITY_BY_SEGMENT,
} from "../lib/customFieldDefs";

const router = Router();

/**
 * The type-scoping half of a definition write.
 *
 * `appliesToAllTypes` is a FLAG rather than "every type id we know about",
 * which is the whole reason it exists: a list of today's types silently fails
 * to apply to a type created tomorrow, and the user who ticked "All" would
 * never find out. A definition sent with the flag needs no ids at all.
 */
function parseScoping(body: {
  placeTypeIds?: unknown;
  tripTypes?: unknown;
  appliesToAllTypes?: unknown;
}): { placeTypeIds?: string[]; tripTypes?: string[]; appliesToAllTypes?: boolean } {
  const out: {
    placeTypeIds?: string[];
    tripTypes?: string[];
    appliesToAllTypes?: boolean;
  } = {};
  // The same normaliser a trip's own `types` goes through, so a scoping can
  // hold exactly the tags a trip can: trimmed, capped, case-insensitively
  // unique.
  const tripTypes = parseTripTypes(body.tripTypes);
  if (tripTypes !== undefined) out.tripTypes = tripTypes;
  if (body.placeTypeIds !== undefined) {
    if (
      !Array.isArray(body.placeTypeIds) ||
      body.placeTypeIds.some((id) => typeof id !== "string")
    ) {
      throw new AppError(400, "placeTypeIds must be an array of ids");
    }
    out.placeTypeIds = body.placeTypeIds as string[];
  }
  if (body.appliesToAllTypes !== undefined) {
    if (typeof body.appliesToAllTypes !== "boolean") {
      throw new AppError(400, "appliesToAllTypes must be a boolean");
    }
    out.appliesToAllTypes = body.appliesToAllTypes;
  }
  return out;
}

/** `:entity` is the URL segment ("trip-log" | "place"), not the union value. */
function parseEntity(req: AuthenticatedRequest): CustomFieldEntity {
  const entity = ENTITY_BY_SEGMENT[getParam(req.params.entity)];
  if (!entity) throw new AppError(404, "Unknown custom field entity");
  return entity;
}

// GET /custom-fields/:entity — the definitions in force for this user.
//
// WITH their scoping (`placeTypeIds`, `appliesToAllTypes`), because a client
// that holds every definition and cannot tell which type each belongs to has to
// render them all — a campsite form with seven canyon grades on it. The extra
// two keys are additive: a caller that only wants the shape ignores them.
router.get(
  "/:entity",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const entity = parseEntity(req);
    res.json({ fields: await loadScopedDefs(user.id, entity) });
  },
);

// POST /custom-fields/:entity — add one definition.
router.post(
  "/:entity",
  requireAuth,
  userPatchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const entity = parseEntity(req);
    const body = req.body as {
      field?: unknown;
      placeTypeIds?: unknown;
      tripTypes?: unknown;
      appliesToAllTypes?: unknown;
    };
    const def = assertValidDef(body?.field);
    res.status(201).json({
      field: await createFieldDef(user.id, entity, {
        def,
        ...parseScoping(body),
      }),
    });
  },
);

// PATCH /custom-fields/:entity/:key — relabel, retype or re-bound one field.
//
// Addressed by `key`, never by label, and `key` itself is not writable: every
// stored value is keyed by it (see `renameCustomFieldLabel`).
router.patch(
  "/:entity/:key",
  requireAuth,
  userPatchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const entity = parseEntity(req);
    const key = getParam(req.params.key);

    const id = await findDefIdByKey(user.id, entity, key);
    if (!id) throw new AppError(404, "Custom field not found");

    const body = req.body as {
      placeTypeIds?: unknown;
      tripTypes?: unknown;
      appliesToAllTypes?: unknown;
      label?: unknown;
      type?: unknown;
      min?: unknown;
      max?: unknown;
      position?: unknown;
    };
    for (const [field, value] of [
      ["label", body.label],
      ["type", body.type],
    ] as const) {
      if (value !== undefined && typeof value !== "string") {
        throw new AppError(400, `Invalid ${field}`);
      }
    }
    for (const [field, value] of [
      ["min", body.min],
      ["max", body.max],
      ["position", body.position],
    ] as const) {
      if (value !== undefined && value !== null && typeof value !== "number") {
        throw new AppError(400, `Invalid ${field}`);
      }
    }

    await updateFieldDef(user.id, id, {
      ...(body.label !== undefined ? { label: body.label as string } : {}),
      ...(body.type !== undefined ? { type: body.type as string } : {}),
      ...(body.min !== undefined ? { min: body.min as number | null } : {}),
      ...(body.max !== undefined ? { max: body.max as number | null } : {}),
      ...(body.position !== undefined
        ? { position: body.position as number }
        : {}),
      ...parseScoping(body),
    });

    res.json({ fields: await loadScopedDefs(user.id, entity) });
  },
);

// GET /custom-fields/:entity/:key/impact — how many of the user's rows carry a
// value for this field. Shown before a rename/delete is confirmed.
router.get(
  "/:entity/:key/impact",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const entity = parseEntity(req);
    const key = getParam(req.params.key);

    const defs = await loadDefs(user.id, entity);
    if (!defs.some((def) => def.key === key)) {
      throw new AppError(404, "Custom field not found");
    }

    res.json({
      [entityConfig(entity).countResponseKey]: await countRowsWithValue(
        user.id,
        entity,
        key,
      ),
    });
  },
);

// DELETE /custom-fields/:entity/:key — remove the definition and strip its
// value from every row that carried one. Returns the surviving definitions and
// the number of rows whose value was removed.
router.delete(
  "/:entity/:key",
  requireAuth,
  // Same budget as PATCH /users/me — this mutates the same definitions (plus
  // entity rows), and the whole-list path already goes through that limiter.
  userPatchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const entity = parseEntity(req);
    const key = getParam(req.params.key);

    const result = await deleteFieldDefByKey(user.id, entity, key);
    // A user-driven delete of a field that is not there is a 404. (The sync
    // push path calls the store directly, where the same miss is idempotent —
    // a replayed op must not fail.)
    if (!result) throw new AppError(404, "Custom field not found");

    const config = entityConfig(entity);
    res.json({
      // Response key names are entity-specific and predate this router.
      [entity === "tripLog" ? "tripLogCustomFields" : "placeCustomFields"]:
        await loadScopedDefs(user.id, entity),
      [config.removedResponseKey]: result.removed,
    });
  },
);

export default router;
