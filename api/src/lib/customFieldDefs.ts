// Custom field DEFINITIONS — the one place that reads and writes them, and the
// one place that knows a delete is two things.
//
// Definitions are rows in `custom_field_defs` (they used to be an array inside
// `User.uiPreferences`; see the 20260905100000 migration for why they moved).
// The VALUES they describe are still keyed by `key` on the owning rows:
// `TripLog.customFields` at the top level, `Canyon.attributes.customFields`
// nested inside the free-form blob.
//
// That split is the whole reason this module exists. Deleting a definition
// must ALSO strip the now-orphaned values from every row that carried one, in
// one transaction — preserving them would leave them to silently resurface if
// a later field slugged to the same key, and (for canyons) leak the orphans
// into exports. Every write path routes through here so no caller can perform
// half of a delete: the REST route, the whole-list PATCH on /users/me, and the
// sync push handler all call `deleteFieldDef`.
//
// PRIVACY: a label is user-authored text about their canyoning ("permit
// number", "water level"). Nothing here logs a label, a key, or a value.
import { Prisma } from "@prisma/client";
import {
  customFieldDefsFromRows,
  isTripLogCustomFieldDef,
  type CustomFieldEntity,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { AppError } from "../middleware/errorHandler";
import prisma from "../services/prisma";
import {
  customFieldDefDeleteTombstones,
  writeTombstones,
} from "./syncTombstones";

/** The columns a definition row needs to become a `TripLogCustomFieldDef`. */
const DEF_SELECT = {
  id: true,
  entity: true,
  key: true,
  label: true,
  type: true,
  min: true,
  max: true,
  position: true,
} as const;

export type CustomFieldDefRecord = Prisma.CustomFieldDefGetPayload<{
  select: typeof DEF_SELECT;
}>;

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

// ── where the values live ────────────────────────────────────────────────────
//
// Per-entity config isolating the storage-shape differences. The row type stays
// INSIDE each config: `pendingStrips` loads the rows carrying a value for `key`
// and returns one thunk per row that removes it, so callers never see a
// trip-log row or a canyon row and the two shapes need no common type.
//
// Thunks rather than `PrismaPromise`s because the delete runs as an INTERACTIVE
// transaction (it also writes a tombstone), and a promise built from the global
// client would execute outside it — the strip would commit separately from the
// delete it belongs to.
//
// "Carrying a value" excludes null and empty string, matching
// `tripLogHasCustomFieldValue`, which the clients count with.
type StripThunk = (tx: Prisma.TransactionClient) => Promise<unknown>;

type EntityConfig = {
  /** URL segment of the REST route, and the response key names, which stay
   *  entity-specific to match the contract the web already consumes. */
  segment: "trip-log" | "canyon";
  countResponseKey: string;
  removedResponseKey: string;
  pendingStrips: (userId: string, key: string) => Promise<StripThunk[]>;
};

function hasValue(
  fields: Record<string, unknown> | null,
  key: string,
): boolean {
  if (fields == null) return false;
  const value = fields[key];
  return value !== undefined && value !== null && value !== "";
}

const tripLogEntity: EntityConfig = {
  segment: "trip-log",
  countResponseKey: "tripLogCount",
  removedResponseKey: "removedFromTripCount",
  pendingStrips: async (userId, key) => {
    const rows = await prisma.tripLog.findMany({
      where: { userId },
      select: { id: true, customFields: true },
    });
    return rows
      .filter((row) =>
        hasValue(
          isJsonObject(row.customFields)
            ? (row.customFields as Record<string, unknown>)
            : null,
          key,
        ),
      )
      .map((row): StripThunk => {
        const next = { ...(row.customFields as Prisma.JsonObject) };
        delete next[key];
        return (tx) =>
          tx.tripLog.update({
            where: { id: row.id },
            data: { customFields: next },
          });
      });
  },
};

const canyonEntity: EntityConfig = {
  segment: "canyon",
  countResponseKey: "canyonCount",
  removedResponseKey: "removedFromCanyonCount",
  pendingStrips: async (userId, key) => {
    const rows = await prisma.canyon.findMany({
      where: { ownerId: userId },
      select: { id: true, attributes: true },
    });
    return rows
      .filter((row) => hasValue(canyonCustomFieldsRecord(row.attributes), key))
      .map((row): StripThunk => {
        // Preserve every other attribute (notably `sources`) — only the one
        // customFields entry is removed.
        const attributes = isJsonObject(row.attributes) ? row.attributes : {};
        const nextFields = {
          ...(canyonCustomFieldsRecord(row.attributes) ?? {}),
        };
        delete nextFields[key];
        return (tx) =>
          tx.canyon.update({
            where: { id: row.id },
            data: {
              attributes: {
                ...attributes,
                customFields: nextFields,
              } as unknown as Prisma.InputJsonValue,
            },
          });
      });
  },
};

/**
 * One map, so a third entity cannot join `CustomFieldEntity` and miss its
 * storage config — the `Record<CustomFieldEntity, …>` refuses the omission.
 */
const ENTITY_CONFIGS: Record<CustomFieldEntity, EntityConfig> = {
  tripLog: tripLogEntity,
  canyon: canyonEntity,
};

export function entityConfig(entity: CustomFieldEntity): EntityConfig {
  return ENTITY_CONFIGS[entity];
}

/** The two REST segments, for routers that mount one path per entity. */
export const ENTITY_BY_SEGMENT: Record<string, CustomFieldEntity> = {
  "trip-log": "tripLog",
  canyon: "canyon",
};

// ── reads ────────────────────────────────────────────────────────────────────

/** Every definition this user owns, both entities, ordered for display. */
export function loadDefRows(userId: string): Promise<CustomFieldDefRecord[]> {
  return prisma.customFieldDef.findMany({
    where: { ownerId: userId },
    select: DEF_SELECT,
    orderBy: [{ position: "asc" }, { key: "asc" }],
  });
}

/**
 * Both entities' definitions in the `uiPreferences` shape the web and the
 * mobile `/users/me` reader still consume. The table is the source; these two
 * keys are a projection onto the user response, not storage.
 */
export async function defsForUserResponse(
  userId: string,
): Promise<{
  tripLogCustomFields: TripLogCustomFieldDef[];
  canyonCustomFields: TripLogCustomFieldDef[];
}> {
  const rows = await loadDefRows(userId);
  return {
    tripLogCustomFields: customFieldDefsFromRows(rows, "tripLog"),
    canyonCustomFields: customFieldDefsFromRows(rows, "canyon"),
  };
}

export async function loadDefs(
  userId: string,
  entity: CustomFieldEntity,
): Promise<TripLogCustomFieldDef[]> {
  return customFieldDefsFromRows(await loadDefRows(userId), entity);
}

/**
 * The row id behind a (entity, key) the caller owns, or null. Callers address
 * definitions by `key` — it is what the UI, the stored values and the URLs all
 * use — while the row grain needs the id.
 */
export async function findDefIdByKey(
  userId: string,
  entity: CustomFieldEntity,
  key: string,
): Promise<string | null> {
  const row = await prisma.customFieldDef.findFirst({
    where: { ownerId: userId, entity, key },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ── impact ───────────────────────────────────────────────────────────────────

/**
 * How many of the user's rows carry a value for this field — the number the
 * delete confirmation quotes before the user commits. Counted from the same
 * `pendingStrips` the delete would apply, so the number shown can never
 * disagree with the number removed.
 */
export async function countRowsWithValue(
  userId: string,
  entity: CustomFieldEntity,
  key: string,
): Promise<number> {
  return (await entityConfig(entity).pendingStrips(userId, key)).length;
}

// ── writes ───────────────────────────────────────────────────────────────────

/**
 * `position` for a new definition: after everything this user already has for
 * the entity. Read-then-write, deliberately un-serialized — two definitions
 * created concurrently can land on the same position, and
 * `customFieldDefsFromRows` breaks that tie by key rather than letting the
 * order flicker between reads.
 */
async function nextPosition(
  userId: string,
  entity: CustomFieldEntity,
): Promise<number> {
  const last = await prisma.customFieldDef.findFirst({
    where: { ownerId: userId, entity },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

/** Validate a client-supplied definition or throw a 400 naming the field. */
export function assertValidDef(
  def: unknown,
  what = "custom field",
): TripLogCustomFieldDef {
  if (!isTripLogCustomFieldDef(def)) {
    throw new AppError(400, `Invalid ${what}`);
  }
  return def;
}

export type CreateDefInput = {
  /** Client-minted UUIDv4 when the definition came from an offline device, so
   *  a replayed push is idempotent. Server-minted otherwise. */
  id?: string;
  def: TripLogCustomFieldDef;
  position?: number;
};

/**
 * Create one definition. A duplicate `key` for the same owner and entity is a
 * 409 rather than a silent no-op: the client asked for a NEW field and the
 * label it chose is already taken, which is a thing the user has to see.
 */
export async function createFieldDef(
  userId: string,
  entity: CustomFieldEntity,
  input: CreateDefInput,
): Promise<TripLogCustomFieldDef> {
  const { def } = input;
  try {
    await prisma.customFieldDef.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        ownerId: userId,
        entity,
        key: def.key,
        label: def.label,
        type: def.type,
        min: def.min ?? null,
        max: def.max ?? null,
        position: input.position ?? (await nextPosition(userId, entity)),
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      throw new AppError(409, `A field with the key "${def.key}" already exists.`);
    }
    throw e;
  }
  return def;
}

/**
 * Update a definition in place. `key` is NEVER writable — every stored value is
 * keyed by it, so changing it would orphan all of them; a rename changes the
 * `label` only, which is exactly what `renameCustomFieldLabel` produces.
 */
export async function updateFieldDef(
  userId: string,
  id: string,
  patch: { label?: string; type?: string; min?: number | null; max?: number | null; position?: number },
): Promise<void> {
  const existing = await prisma.customFieldDef.findFirst({
    where: { id, ownerId: userId },
    select: DEF_SELECT,
  });
  // 404, not 403: an id the caller does not own must not be confirmed to
  // exist. Definitions are per-user, so there is no sharee case here.
  if (!existing) throw new AppError(404, "Custom field not found");

  const merged = {
    key: existing.key,
    label: patch.label ?? existing.label,
    type: patch.type ?? existing.type,
    min: patch.min !== undefined ? patch.min : existing.min,
    max: patch.max !== undefined ? patch.max : existing.max,
  };
  // Validate the RESULT, not the patch: a patch that only moves `min` can still
  // produce an invalid definition (min >= max, bounds on a date field).
  assertValidDef({
    key: merged.key,
    label: merged.label,
    type: merged.type,
    ...(merged.min != null && merged.max != null
      ? { min: merged.min, max: merged.max }
      : {}),
  });

  await prisma.customFieldDef.update({
    where: { id },
    data: {
      label: merged.label,
      type: merged.type,
      min: merged.min,
      max: merged.max,
      ...(patch.position !== undefined ? { position: patch.position } : {}),
    },
  });
}

export type DeleteResult = {
  /** How many rows lost a value. */
  removed: number;
  entity: CustomFieldEntity;
  key: string;
};

/**
 * Delete a definition AND strip its value from every row that carried one, in
 * one transaction. Both halves or neither — a definition removed without its
 * values leaves orphans that resurface under a later field with the same slug.
 *
 * Idempotent by design: a definition that is already gone resolves with
 * `removed: 0` instead of throwing, because the sync push path replays ops and
 * a delete that succeeded before a dropped response must not fail on retry.
 * The REST route checks existence itself so a user-driven delete of a
 * nonexistent field still 404s.
 */
export async function deleteFieldDef(
  userId: string,
  id: string,
): Promise<DeleteResult | null> {
  const existing = await prisma.customFieldDef.findFirst({
    where: { id, ownerId: userId },
    select: { id: true, entity: true, key: true },
  });
  if (!existing) return null;

  const entity = existing.entity as CustomFieldEntity;
  const strips = await entityConfig(entity).pendingStrips(userId, existing.key);

  await prisma.$transaction(async (tx) => {
    for (const strip of strips) await strip(tx);
    await tx.customFieldDef.delete({ where: { id: existing.id } });
    // Same transaction as the delete, never after it — a crash in between
    // would leave every other device showing a definition that is gone.
    await writeTombstones(
      tx,
      customFieldDefDeleteTombstones({ ownerId: userId, defId: existing.id }),
    );
  });

  return { removed: strips.length, entity, key: existing.key };
}

/** Delete addressed by key rather than id — what the REST route and the
 *  whole-list PATCH both have in hand. */
export async function deleteFieldDefByKey(
  userId: string,
  entity: CustomFieldEntity,
  key: string,
): Promise<DeleteResult | null> {
  const existing = await prisma.customFieldDef.findFirst({
    where: { ownerId: userId, entity, key },
    select: { id: true },
  });
  return existing ? deleteFieldDef(userId, existing.id) : null;
}

// ── whole-list write (the web's shape) ───────────────────────────────────────

/**
 * Reconcile the whole list for one entity: create what is new, update what
 * moved, delete (with the value strip) what the caller dropped.
 *
 * This exists because the web edits definitions as a list — `PATCH /users/me`
 * with `{ canyonCustomFields: [...] }` is what every dialog in the frontend
 * sends, and rewriting all of them to row-grain REST buys nothing while a
 * single browser tab is the only writer. Mobile does NOT use this path: it
 * pushes per-row ops through the sync engine, where the row grain is what
 * makes two devices' concurrent edits merge instead of clobber.
 *
 * Rows are matched by `key`, which is stable across a rename, so a relabelled
 * field updates in place and keeps its values.
 */
export async function replaceFieldDefs(
  userId: string,
  entity: CustomFieldEntity,
  defs: TripLogCustomFieldDef[],
): Promise<void> {
  const existing = await prisma.customFieldDef.findMany({
    where: { ownerId: userId, entity },
    select: DEF_SELECT,
  });
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const incomingKeys = new Set(defs.map((def) => def.key));

  // Deletes first, and one at a time: each carries its own value strip, and
  // that strip rewrites rows the later creates never touch.
  for (const row of existing) {
    if (!incomingKeys.has(row.key)) await deleteFieldDef(userId, row.id);
  }

  for (const [position, def] of defs.entries()) {
    const row = byKey.get(def.key);
    if (!row) {
      await createFieldDef(userId, entity, { def, position });
      continue;
    }
    const unchanged =
      row.label === def.label &&
      row.type === def.type &&
      row.min === (def.min ?? null) &&
      row.max === (def.max ?? null) &&
      row.position === position;
    if (unchanged) continue;
    await updateFieldDef(userId, row.id, {
      label: def.label,
      type: def.type,
      min: def.min ?? null,
      max: def.max ?? null,
      position,
    });
  }
}
