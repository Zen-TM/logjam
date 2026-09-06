// The database half of copying someone else's place (plan §2.6).
//
// The decisions themselves are pure and live in `shared/src/placeCopy.ts`, so
// both clients can predict them and a test needs no Postgres. What is here is
// the part that needs rows: which TYPE the copy lands in, and which definitions
// describe the values on each side of the reconciliation.
//
// One function, called from one place (POST /places/:id/copy) — but written as
// a lib rather than inline because the phone will need the same answer when the
// copy flow gets its type picker, and a second implementation of "which type
// does this land in" is exactly the drift §2.6 rule 1 exists to prevent.

import type { ForeignFieldValue, TripLogCustomFieldDef } from "@logjam/shared";
import {
  asFieldValues,
  asForeignFields,
  matchPlaceTypeByName,
  mergeForeignFields,
  reconcileCopiedFieldValues,
} from "@logjam/shared";

import { AppError } from "../middleware/errorHandler";
import prisma from "../services/prisma";
import { createPlaceType, defsForPlaceType, visiblePlaceTypeWhere } from "./placeTypes";

export type CopyTypeResolution = {
  placeTypeId: string;
  /** True when a type was created for this copy — the caller says so in the
   *  response, because a new tab appearing unannounced reads as a bug. */
  created: boolean;
};

/**
 * The type a copy of `sourceTypeId` lands in for `recipientId`.
 *
 * §2.6 rule 1, in order:
 *  1. A SYSTEM type resolves globally — one row shared by every account — so a
 *     copied canyon needs no reconciliation at all.
 *  2. Otherwise match the sender's type NAME case-insensitively against the
 *     recipient's SYSTEM types first, then their own. Matching on name rather
 *     than branching on the sender's type kind is what stops a sender's own
 *     "Campsite" minting a second, user-owned Campsite beside the system one.
 *  3. No match: create a user type named after the sender's, carrying its icon
 *     and colour so the copy looks like what was sent.
 *
 * `requested` is rule 2's explicit picker: the copy sheet pre-fills it with the
 * answer above and the user may override it. It is validated against the types
 * the recipient may actually use, so a foreign id is a 400 like any other bad
 * `placeTypeId` rather than a silent fallback.
 */
export async function resolveCopyPlaceType(
  recipientId: string,
  sourceTypeId: string,
  requested?: unknown,
): Promise<CopyTypeResolution> {
  if (requested !== undefined && requested !== null) {
    if (typeof requested !== "string" || requested.length === 0) {
      throw new AppError(400, "placeTypeId is required");
    }
    const chosen = await prisma.placeType.findFirst({
      where: { id: requested, ...visiblePlaceTypeWhere(recipientId) },
      select: { id: true },
    });
    if (!chosen) throw new AppError(400, "Unknown place type");
    return { placeTypeId: chosen.id, created: false };
  }

  const source = await prisma.placeType.findUnique({
    where: { id: sourceTypeId },
    select: { id: true, ownerId: true, name: true, iconKey: true, color: true },
  });
  // A place whose type row vanished cannot be copied into a guess. This cannot
  // happen through the API (a type holding places refuses to be deleted), so it
  // is a 500-shaped situation reported as one rather than papered over.
  if (!source) throw new AppError(500, "The place's type is missing");

  if (source.ownerId === null) return { placeTypeId: source.id, created: false };

  const candidates = await prisma.placeType.findMany({
    where: visiblePlaceTypeWhere(recipientId),
    select: { id: true, ownerId: true, name: true },
  });
  const matched = matchPlaceTypeByName(source.name, candidates);
  if (matched) return { placeTypeId: matched.id, created: false };

  const created = await createPlaceType(recipientId, undefined, {
    name: source.name,
    iconKey: source.iconKey,
    color: source.color,
  });
  return { placeTypeId: created.id, created: true };
}

/**
 * The values a copy keeps and the ones it parks, for a copy landing in
 * `placeTypeId`.
 *
 * The SOURCE's `foreignFields` are deliberately NOT read here: a copy clears
 * them rather than concatenating (§2.6). A copy-of-a-copy reconciles the
 * sender's `fieldValues` against the recipient's definitions and nothing else —
 * otherwise residue accumulates down a share chain with no owner and no way to
 * clear it.
 */
export async function reconcileCopiedPlace(args: {
  recipientId: string;
  sourceOwnerId: string;
  sourceTypeId: string;
  targetTypeId: string;
  fieldValues: unknown;
}): Promise<{
  fieldValues: Record<string, unknown>;
  foreignFields: ReturnType<typeof reconcileCopiedFieldValues>["foreignFields"];
}> {
  const [senderDefs, recipientDefs]: TripLogCustomFieldDef[][] = await Promise.all([
    defsForPlaceType(args.sourceOwnerId, args.sourceTypeId),
    defsForPlaceType(args.recipientId, args.targetTypeId),
  ]);
  return reconcileCopiedFieldValues({
    fieldValues: args.fieldValues,
    senderDefs,
    recipientDefs,
  });
}

/**
 * A place's values after its TYPE changes — the second writer of
 * `foreignFields` and the last (§2.6 scope discipline).
 *
 * Miscategorising is inevitable and a type change is a legal edit, so it must
 * not destroy what the user typed under the old type. A value the new type has
 * no definition for is parked rather than deleted or left in `fieldValues`
 * where nothing renders it: parked, it is visible, labelled, and adoptable into
 * the new type with one tap.
 *
 * APPENDS rather than clears, unlike a copy: the row keeps its owner, so an
 * earlier stranding is still theirs. Same key twice keeps the newest.
 */
export async function strandValuesOnTypeChange(args: {
  ownerId: string;
  fromTypeId: string;
  toTypeId: string;
  fieldValues: unknown;
  foreignFields: unknown;
}): Promise<{ fieldValues: Record<string, unknown>; foreignFields: ForeignFieldValue[] }> {
  // Not a type change at all: nothing is stranded, and running the split with
  // no definitions would park EVERY value (no recipient def matches), which is
  // the opposite of what a same-type write means.
  if (args.fromTypeId === args.toTypeId) {
    return {
      fieldValues: asFieldValues(args.fieldValues),
      foreignFields: asForeignFields(args.foreignFields),
    };
  }
  const [fromDefs, toDefs]: TripLogCustomFieldDef[][] = await Promise.all([
    defsForPlaceType(args.ownerId, args.fromTypeId),
    defsForPlaceType(args.ownerId, args.toTypeId),
  ]);
  const split = reconcileCopiedFieldValues({
    fieldValues: args.fieldValues,
    senderDefs: fromDefs,
    recipientDefs: toDefs,
  });
  return {
    fieldValues: split.fieldValues,
    foreignFields: mergeForeignFields(
      asForeignFields(args.foreignFields),
      split.foreignFields,
    ),
  };
}
