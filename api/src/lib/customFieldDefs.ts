// Custom field DEFINITIONS — the one place that reads and writes them, and the
// one place that knows a delete is two things.
//
// Definitions are rows in `custom_field_defs` (they used to be an array inside
// `User.uiPreferences`; see the 20260905100000 migration for why they moved).
// The VALUES they describe are still keyed by `key` on the owning rows:
// `TripLog.customFields` at the top level, `Place.attributes.customFields`
// nested inside the free-form blob.
//
// That split is the whole reason this module exists. Deleting a definition
// must ALSO strip the now-orphaned values from every row that carried one, in
// one transaction — preserving them would leave them to silently resurface if
// a later field slugged to the same key, and (for places) leak the orphans
// into exports. Every write path routes through here so no caller can perform
// half of a delete: the REST route, the whole-list PATCH on /users/me, and the
// sync push handler all call `deleteFieldDef`.
//
// PRIVACY: a label is user-authored text about their canyoning ("permit
// number", "water level"). Nothing here logs a label, a key, or a value.
import { Prisma } from "@prisma/client";
import {
  customFieldDefFromRow,
  customFieldDefsFromRows,
  isReservedFieldKey,
  isTripLogCustomFieldDef,
  makeCustomFieldKey,
  reservedFieldKeyError,
  setFieldValues,
  userFieldValues,
  type CustomFieldEntity,
  type ScopedCustomFieldDef,
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
  // WHOSE it is: null for a system definition. The clients need it to know
  // which rows may be renamed or deleted — without it the phone offered both
  // on a built-in field and did the local half of the delete for real.
  ownerId: true,
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

// The user-visible field values of a place, or null when it has none.
//
// Values used to be NESTED, at `attributes.customFields[key]`, and are now at
// the TOP level of `fieldValues` — the forward migration hoists them. The
// internal `_`-prefixed entries (`_sources`) are excluded here because they are
// not fields: a delete would otherwise offer to strip the source list off every
// place. Exported for unit testing.
export function placeCustomFieldsRecord(
  fieldValues: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (!isJsonObject(fieldValues)) return null;
  const values = userFieldValues(fieldValues);
  return Object.keys(values).length > 0 ? values : null;
}

// ── where the values live ────────────────────────────────────────────────────
//
// Per-entity config isolating the storage-shape differences. The row type stays
// INSIDE each config: `pendingStrips` loads the rows carrying a value for `key`
// and returns one thunk per row that removes it, so callers never see a
// trip-log row or a place row and the two shapes need no common type.
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
  segment: "trip-log" | "place";
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

const placeEntity: EntityConfig = {
  segment: "place",
  countResponseKey: "placeCount",
  removedResponseKey: "removedFromPlaceCount",
  pendingStrips: async (userId, key) => {
    const rows = await prisma.place.findMany({
      where: { ownerId: userId },
      select: { id: true, fieldValues: true },
    });
    return rows
      .filter((row) => hasValue(placeCustomFieldsRecord(row.fieldValues), key))
      .map((row): StripThunk => {
        // Removes ONE key. The internal `_sources` entry rides
        // in the same object and must survive — before the hoist they were
        // siblings of the customFields sub-object and survived structurally;
        // now they are siblings of the values themselves, so `setFieldValues`
        // has to be the thing that keeps them.
        const next = setFieldValues(row.fieldValues, { [key]: null });
        return (tx) =>
          tx.place.update({
            where: { id: row.id },
            data: { fieldValues: next as Prisma.InputJsonValue },
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
  place: placeEntity,
};

export function entityConfig(entity: CustomFieldEntity): EntityConfig {
  return ENTITY_CONFIGS[entity];
}

/** The two REST segments, for routers that mount one path per entity. */
export const ENTITY_BY_SEGMENT: Record<string, CustomFieldEntity> = {
  "trip-log": "tripLog",
  place: "place",
};

// ── reads ────────────────────────────────────────────────────────────────────

/** Every definition this user owns, both entities, ordered for display. */
export function loadDefRows(userId: string): Promise<CustomFieldDefRecord[]> {
  return prisma.customFieldDef.findMany({
    // The user's own PLUS the SYSTEM definitions (ownerId null), which label
    // the built-in fields and belong to no account. Omitting them left every
    // value RopeWiki import writes — and every grade a canyon has ever had —
    // rendering as a bare key with no label and no bounds, because the one
    // list the clients read did not contain the definitions that describe them.
    where: { OR: [{ ownerId: userId }, { ownerId: null }] },
    select: DEF_SELECT,
    // `customFieldDefsFromRows` re-sorts by (position, key) for display, so
    // this ordering is only for callers that read the rows directly.
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
  placeCustomFields: TripLogCustomFieldDef[];
}> {
  const rows = await loadDefRows(userId);
  return {
    tripLogCustomFields: customFieldDefsFromRows(rows, "tripLog"),
    placeCustomFields: customFieldDefsFromRows(rows, "place"),
  };
}

export async function loadDefs(
  userId: string,
  entity: CustomFieldEntity,
): Promise<TripLogCustomFieldDef[]> {
  return customFieldDefsFromRows(await loadDefRows(userId), entity);
}

/**
 * The same definitions WITH their scoping — what a form builder needs.
 *
 * `loadDefs` answers "what shape is this value", which is what a renderer, a
 * filter and a validator want; this answers "where does it appear", which is
 * what decides whether a campsite's form shows a V grade. Two reads rather than
 * one type carrying both, because the scoped shape is wanted by two callers and
 * the plain one by dozens.
 */
export async function loadScopedDefs(
  userId: string,
  entity: CustomFieldEntity,
): Promise<ScopedCustomFieldDef[]> {
  const rows = await prisma.customFieldDef.findMany({
    where: { entity, OR: [{ ownerId: userId }, { ownerId: null }] },
    select: {
      ...DEF_SELECT,
      appliesToAllTypes: true,
      tripTypes: true,
      placeTypes: { select: { placeTypeId: true } },
    },
    orderBy: [{ position: "asc" }, { key: "asc" }],
  });
  return rows.flatMap((row) => {
    const def = customFieldDefFromRow(row);
    // A row that cannot become a definition (a type this build does not know,
    // a bound that is not a number) is skipped rather than half-rendered —
    // the same tolerance `customFieldDefsFromRows` applies.
    if (!def) return [];
    return [
      {
        ...def,
        ownerId: row.ownerId,
        appliesToAllTypes: row.appliesToAllTypes,
        placeTypeIds: row.placeTypes.map((link) => link.placeTypeId),
        tripTypes: row.tripTypes,
      },
    ];
  });
}

/**
 * Each entity has ONE kind of scoping: a place field names place types, a trip
 * field names trip types. A write that fills the other list is a client bug,
 * and a 400 rather than a silent drop — a scoping the server threw away would
 * leave the field on forms the user never chose, or on none.
 */
function assertScopingFitsEntity(
  entity: string,
  scoping: { placeTypeIds?: string[]; tripTypes?: string[] },
): void {
  if (entity === "place" && scoping.tripTypes?.length) {
    throw new AppError(400, "tripTypes only applies to trip attributes");
  }
  if (entity === "tripLog" && scoping.placeTypeIds?.length) {
    throw new AppError(
      400,
      "placeTypeIds only applies to place attributes; a trip attribute is scoped by tripTypes",
    );
  }
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

/**
 * Refuse a key that a system definition already owns.
 *
 * A user field labelled "V grade" on their own Campsite type slugs to
 * `v_grade` — the key RopeWiki import writes into Canyon. Two writers, one key,
 * in one owner's namespace: the import would overwrite their value, or their
 * value would render under the built-in field's label and bounds.
 *
 * Only for USER definitions. The system rows legitimately hold these keys, and
 * the seed and the migration create them directly.
 *
 * The list is derived from the seeded definitions (`RESERVED_FIELD_KEYS`), not
 * restated here — see the note on that constant.
 */
function assertKeyNotReserved(key: string, label: string): void {
  if (isReservedFieldKey(key)) {
    throw new AppError(409, reservedFieldKeyError(key, label));
  }
}

export type CreateDefInput = {
  /** Client-minted UUIDv4 when the definition came from an offline device, so
   *  a replayed push is idempotent. Server-minted otherwise. */
  id?: string;
  def: TripLogCustomFieldDef;
  position?: number;
  /** Place types a PLACE definition applies to. Refused on a trip definition. */
  placeTypeIds?: string[];
  /** Trip types (tags) a TRIP definition applies to, already normalised by
   *  `parseTripTypes`. Refused on a place definition. */
  tripTypes?: string[];
  /** Applies to every type, including ones created later. A flag rather than
   *  a list of the types that exist today, which would silently fail to apply
   *  to tomorrow's. */
  appliesToAllTypes?: boolean;
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
  assertKeyNotReserved(def.key, def.label);
  assertScopingFitsEntity(entity, input);
  const placeTypeIds = await ownedPlaceTypeIds(userId, input.placeTypeIds);
  const tripTypes = input.tripTypes ?? [];
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
        // A DEFINITION THAT NAMES NO TYPES IS ON EVERY FORM, because the
        // alternative is a row that appears on none of them: `defsForType` and
        // `tripFieldDefs` both ask "all types, or one of these?", so a def with
        // the flag off and an empty scoping exists in the settings list and
        // nowhere else. That is what a caller that never heard of the scoping
        // produces (every pre-rework caller, and Logjam Web, which has no
        // picker for a trip field). Defaulting false made all three of alice's
        // trip fields invisible on the trip form — found by reading the
        // phone's mirror, not by a test.
        appliesToAllTypes:
          input.appliesToAllTypes ??
          (placeTypeIds.length === 0 && tripTypes.length === 0),
        tripTypes,
        ...(placeTypeIds.length
          ? {
              placeTypes: {
                create: placeTypeIds.map((placeTypeId) => ({ placeTypeId })),
              },
            }
          : {}),
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
  patch: {
    label?: string;
    type?: string;
    min?: number | null;
    max?: number | null;
    position?: number;
    placeTypeIds?: string[];
    /** Already normalised by `parseTripTypes`. Replaced, not merged. */
    tripTypes?: string[];
    appliesToAllTypes?: boolean;
  },
): Promise<void> {
  const existing = await prisma.customFieldDef.findFirst({
    where: { id, ownerId: userId },
    select: DEF_SELECT,
  });
  // 404, not 403: an id the caller does not own must not be confirmed to
  // exist. Definitions are per-user, so there is no sharee case here.
  if (!existing) throw new AppError(404, "Custom field not found");
  assertScopingFitsEntity(existing.entity, patch);

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

  // A RENAME cannot take a reserved label either. The key never moves on a
  // rename (every stored value is keyed by it), so this is not a data
  // collision — it is two fields displaying the same name, one of them the
  // built-in, which is worse than useless on a form.
  if (patch.label !== undefined) {
    assertKeyNotReserved(makeCustomFieldKey(merged.label), merged.label);
  }

  const placeTypeIds =
    patch.placeTypeIds === undefined
      ? undefined
      : await ownedPlaceTypeIds(userId, patch.placeTypeIds);

  await prisma.$transaction(async (tx) => {
    await tx.customFieldDef.update({
      where: { id },
      data: {
        label: merged.label,
        type: merged.type,
        min: merged.min,
        max: merged.max,
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        ...(patch.appliesToAllTypes !== undefined
          ? { appliesToAllTypes: patch.appliesToAllTypes }
          : {}),
        ...(patch.tripTypes !== undefined ? { tripTypes: patch.tripTypes } : {}),
      },
    });
    // Scoping is REPLACED rather than merged: the client sends the set it
    // wants, and a diff would make "remove the last type" unexpressible.
    if (placeTypeIds !== undefined) {
      await tx.customFieldDefPlaceType.deleteMany({ where: { defId: id } });
      if (placeTypeIds.length) {
        await tx.customFieldDefPlaceType.createMany({
          data: placeTypeIds.map((placeTypeId) => ({ defId: id, placeTypeId })),
        });
      }
    }
  });
}

/**
 * Narrow a requested scoping to types this user may actually scope to: their
 * own, plus the global system types. Silently dropping a foreign id rather than
 * erroring is deliberate — the ids arrive from an offline client whose mirror
 * may name a type that has since been deleted, and parking that op in the sync
 * shelf would cost the user a field over a stale reference. An id that survives
 * is one they can see.
 */
async function ownedPlaceTypeIds(
  userId: string,
  requested: string[] | undefined,
): Promise<string[]> {
  if (!requested?.length) return [];
  const rows = await prisma.placeType.findMany({
    where: {
      id: { in: requested },
      OR: [{ ownerId: userId }, { ownerId: null }],
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
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
