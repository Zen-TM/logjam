// Resolving a place's type, and the field definitions in force for it.
//
// Two questions every place write has to answer, in one place so they cannot be
// answered differently on the REST path and the sync-push path — which is
// exactly how a validation rule ends up applying to one client and not the
// other.
//
// VISIBILITY: a user may use their OWN types and the SYSTEM types (ownerId
// null), and nothing else. System types are global — one row shared by every
// user — which is what makes a shared or copied place of a system type resolve
// for its recipient with no reconciliation at all.
import { Prisma } from "@prisma/client";
import {
  freePlaceTypeName,
  isPlaceTypeColor,
  isPlaceTypeIconKey,
  nameKey,
  PLACE_TYPE_NAME_MAX_LENGTH,
  placeTypeNameTaken,
  placeTypeNameTakenError,
  type CustomFieldEntity,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { AppError } from "../middleware/errorHandler";
import prisma from "../services/prisma";

/** Types this user may put a place into: their own plus the system ones. */
export function visiblePlaceTypeWhere(userId: string) {
  return { OR: [{ ownerId: userId }, { ownerId: null }] };
}

/**
 * Validate a requested place type and return its id.
 *
 * Throws rather than defaulting. A silent default to Canyon would file a
 * campsite the client forgot to type under canyons, where the user would never
 * think to look for it — and the request would look like it succeeded.
 *
 * 400, not 404: the id is a field of the payload, not the resource being
 * addressed, so this is a malformed request rather than a missing place. It
 * also means an id belonging to another user reads the same as a nonexistent
 * one, which is the anti-oracle rule applied to a field.
 */
export async function resolvePlaceTypeId(
  userId: string,
  requested: unknown,
): Promise<string> {
  if (typeof requested !== "string" || requested.length === 0) {
    throw new AppError(400, "placeTypeId is required");
  }
  const type = await prisma.placeType.findFirst({
    where: { id: requested, ...visiblePlaceTypeWhere(userId) },
    select: { id: true },
  });
  if (!type) throw new AppError(400, "Unknown place type");
  return type.id;
}

/**
 * The definitions that apply to a place of `placeTypeId`, for one user.
 *
 * Two sources, unioned:
 *  - definitions SCOPED to this type through the join table;
 *  - definitions flagged `appliesToAllTypes`.
 *
 * The flag is why this is a union rather than a join: scoping "all" as join
 * rows for the types that exist today would silently fail to apply to a type
 * created tomorrow, which is the parallel-list drift the root CLAUDE.md rule
 * targets. A newly created type inherits every `All` definition for free,
 * because there is nothing to add it to.
 *
 * System definitions (ownerId null) are visible to everyone, so they are
 * included alongside the user's own.
 */
export async function defsForPlaceType(
  userId: string,
  placeTypeId: string,
  entity: CustomFieldEntity = "place",
): Promise<TripLogCustomFieldDef[]> {
  const rows = await prisma.customFieldDef.findMany({
    where: {
      entity,
      OR: [{ ownerId: userId }, { ownerId: null }],
      AND: [
        {
          OR: [
            { appliesToAllTypes: true },
            { placeTypes: { some: { placeTypeId } } },
          ],
        },
      ],
    },
    select: { key: true, label: true, type: true, min: true, max: true },
    orderBy: [{ position: "asc" }, { key: "asc" }],
  });
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    type: row.type as TripLogCustomFieldDef["type"],
    ...(row.min !== null ? { min: row.min } : {}),
    ...(row.max !== null ? { max: row.max } : {}),
  }));
}

// ── lifecycle ───────────────────────────────────────────────────────────────
//
// One implementation for both write paths. The REST router and the sync push
// handler call these rather than each doing their own thing, because a rule
// enforced on one path and not the other is a rule that holds until someone
// uses the other client.

export type PlaceTypeInput = {
  name: string;
  iconKey: string;
  color: string;
  position?: number;
};

/** Validate a client-supplied type, or throw a 400 naming what is wrong. */
export function assertValidPlaceType(input: {
  name?: unknown;
  iconKey?: unknown;
  color?: unknown;
  position?: unknown;
}): PlaceTypeInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new AppError(400, "A place type needs a name.");
  if (name.length > PLACE_TYPE_NAME_MAX_LENGTH) {
    throw new AppError(
      400,
      `A place type name must be ${PLACE_TYPE_NAME_MAX_LENGTH} characters or fewer.`,
    );
  }
  // Icon and colour come from CURATED lists, not free text. The icon because a
  // free key resolves in one client's icon set and not the other's; the colour
  // because a type's colour is a map marker colour, and the WCAG 3:1 guarantee
  // in scripts/wcag-contrast.mjs can only be asserted over a closed set.
  if (!isPlaceTypeIconKey(input.iconKey)) {
    throw new AppError(400, "Unknown icon");
  }
  if (!isPlaceTypeColor(input.color)) {
    throw new AppError(400, "Unknown colour");
  }
  if (input.position !== undefined && typeof input.position !== "number") {
    throw new AppError(400, "Invalid position");
  }
  return {
    name,
    iconKey: input.iconKey,
    color: input.color.toUpperCase(),
    ...(typeof input.position === "number" ? { position: input.position } : {}),
  };
}

/**
 * The user's own type row, or a 404.
 *
 * A SYSTEM type resolves to 404 here too, deliberately: it is visible to
 * everyone but owned by no one, so "edit" and "delete" are not things a user
 * may do to it. 404 rather than 403 keeps this consistent with every other
 * id-addressed surface — the caller learns nothing about a row they cannot act
 * on. System types being undeletable is not a nicety: RopeWiki import writes
 * reserved field keys into the Canyon type, so a deleted Canyon type would let
 * import write values nothing can render.
 */
export async function requireOwnPlaceType(userId: string, id: string) {
  const type = await prisma.placeType.findFirst({
    where: { id, ownerId: userId },
  });
  if (!type) throw new AppError(404, "Place type not found");
  return type;
}

/**
 * What a write does when the name it asks for is taken (`placeTypeNameTaken`:
 * compared as a person reads it, built-ins included).
 *
 * REST refuses with a 409: the user is looking at the form and can pick
 * another. The sync push renames to the next free "name (2)": that write was
 * made with no signal, where refusing it parks an op the user can only
 * discard — and discarding a type's create discards the places made of it
 * (`freePlaceTypeName`). Guard: `src/__tests__/placeTypes.test.ts`.
 */
export type OnNameTaken = "refuse" | "rename";

async function settlePlaceTypeName(
  userId: string,
  name: string,
  onTaken: OnNameTaken,
  exceptId?: string,
): Promise<string> {
  const types = await prisma.placeType.findMany({
    where: visiblePlaceTypeWhere(userId),
    select: { id: true, name: true },
  });
  if (!placeTypeNameTaken(name, types, exceptId)) return name;
  if (onTaken === "refuse") {
    throw new AppError(409, placeTypeNameTakenError(name));
  }
  return freePlaceTypeName(name, types, exceptId);
}

/** The database's own exact-match unique index, lost to a concurrent write
 *  between the check above and the insert. Same answer as the check. */
function rethrowNameRace(e: unknown, name: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new AppError(409, placeTypeNameTakenError(name));
  }
  throw e;
}

export async function createPlaceType(
  userId: string,
  id: string | undefined,
  input: PlaceTypeInput,
  onNameTaken: OnNameTaken = "refuse",
) {
  const name = await settlePlaceTypeName(userId, input.name, onNameTaken);
  const position =
    input.position ??
    (await prisma.placeType.count({ where: { ownerId: userId } }));
  try {
    return await prisma.placeType.create({
      data: {
        ...(id ? { id } : {}),
        ownerId: userId,
        name,
        iconKey: input.iconKey,
        color: input.color,
        position,
      },
    });
  } catch (e) {
    rethrowNameRace(e, name);
  }
}

/**
 * Write a validated result over a type the user owns.
 *
 * The name is checked only when it MOVES to one that reads differently: a
 * recolour of a type whose name already collides (rows from before the rule)
 * must still save, and so must fixing a name's capitals.
 */
export async function updatePlaceType(
  userId: string,
  current: { id: string; name: string },
  merged: PlaceTypeInput,
  onNameTaken: OnNameTaken = "refuse",
) {
  const name =
    nameKey(merged.name) === nameKey(current.name)
      ? merged.name
      : await settlePlaceTypeName(userId, merged.name, onNameTaken, current.id);
  try {
    return await prisma.placeType.update({
      where: { id: current.id },
      data: { ...merged, name },
    });
  } catch (e) {
    rethrowNameRace(e, name);
  }
}

export type DeletePlaceTypeResult =
  | { ok: true; removedDefs: number }
  | { ok: false; placeCount: number };

/**
 * Delete a type the user owns.
 *
 * BLOCKED while any place still uses it — the caller offers a reassign rather
 * than this cascading places away. A type is a category, and deleting a
 * category must never delete what is in it.
 *
 * An empty type takes with it the definitions scoped ONLY to it: a def left
 * behind would apply to nothing, be invisible in every form, and still occupy
 * its key in the owner's namespace — so the next field the user names the same
 * way would 409 against something they cannot see. Definitions scoped to other
 * types as well, and `appliesToAllTypes` ones, lose only the scoping row.
 *
 * Done SERVER-SIDE, in one transaction, for the reason the sync protocol
 * comment already gives for customFieldDef deletes: a phone can only reach the
 * rows in its own mirror, so anything stripped client-side resurfaces.
 */
export async function deletePlaceType(
  userId: string,
  id: string,
): Promise<DeletePlaceTypeResult> {
  await requireOwnPlaceType(userId, id);

  const placeCount = await prisma.place.count({ where: { placeTypeId: id } });
  if (placeCount > 0) return { ok: false, placeCount };

  return prisma.$transaction(async (tx) => {
    const scoped = await tx.customFieldDefPlaceType.findMany({
      where: { placeTypeId: id },
      select: { defId: true },
    });
    const orphanIds: string[] = [];
    for (const { defId } of scoped) {
      const otherScopings = await tx.customFieldDefPlaceType.count({
        where: { defId, placeTypeId: { not: id } },
      });
      if (otherScopings > 0) continue;
      const def = await tx.customFieldDef.findUnique({
        where: { id: defId },
        select: { appliesToAllTypes: true, ownerId: true },
      });
      // Never delete a system def, whatever it is scoped to.
      if (!def || def.appliesToAllTypes || def.ownerId === null) continue;
      orphanIds.push(defId);
    }
    if (orphanIds.length) {
      await tx.customFieldDef.deleteMany({ where: { id: { in: orphanIds } } });
    }
    await tx.placeType.delete({ where: { id } });
    return { ok: true as const, removedDefs: orphanIds.length };
  });
}
