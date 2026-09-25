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
 *
 * AND IT RUNS BOTH WAYS. What is already parked is fed back through the same
 * split, so a key the NEW type does define comes home to `fieldValues`
 * automatically. Without that half, retyping was a one-way door in practice:
 * canyon → campsite stranded the seven canyon axes, and campsite → canyon left
 * them sitting in "doesn't fit this type" beside a form with an empty V-grade
 * rail — asking the user to re-adopt values the type already has a definition
 * for, which the adopt path then REFUSES (409) because those keys are reserved.
 * A mistyped place was a trap you could walk into and not back out of.
 *
 * Feeding the park back in is also what dedups: one pass, keyed, so
 * a separate merge step is not needed on top of it. Each parked item describes
 * itself (`{key,label,type,min,max}` — the same shape a definition has), so it
 * is its own "sender def" and its label survives any number of round trips.
 */
export async function strandValuesOnTypeChange(args: {
  ownerId: string;
  fromTypeId: string;
  toTypeId: string;
  fieldValues: unknown;
  foreignFields: unknown;
}): Promise<{ fieldValues: Record<string, unknown>; foreignFields: ForeignFieldValue[] }> {
  const parked = asForeignFields(args.foreignFields);

  // NOT A TYPE CHANGE. Nothing may be stranded by an ordinary edit — running
  // the full split here would park any live value with no definition on either
  // side, which is a key another client is entitled to have written.
  //
  // The park is still re-matched, in the one direction that can only help: a
  // value the CURRENT type defines comes home. That is what heals a row
  // stranded BEFORE the round trip above existed — there is no migration for
  // those, and the alternative was telling the user to retype the place twice
  // to get their own grades back. Skipped entirely when nothing is parked,
  // which is almost every write.
  if (args.fromTypeId === args.toTypeId) {
    if (parked.length === 0) {
      return {
        fieldValues: asFieldValues(args.fieldValues),
        foreignFields: [],
      };
    }
    const toDefs = await defsForPlaceType(args.ownerId, args.toTypeId);
    const split = reconcileCopiedFieldValues({
      fieldValues: Object.fromEntries(parked.map((item) => [item.key, item.value])),
      senderDefs: parked.map(parkedItemAsDef),
      recipientDefs: toDefs,
    });
    return {
      // Live values last: what the user just typed beats an older copy of the
      // same key waiting in the park.
      fieldValues: { ...split.fieldValues, ...asFieldValues(args.fieldValues) },
      foreignFields: split.foreignFields,
    };
  }

  const [fromDefs, toDefs]: TripLogCustomFieldDef[][] = await Promise.all([
    defsForPlaceType(args.ownerId, args.fromTypeId),
    defsForPlaceType(args.ownerId, args.toTypeId),
  ]);
  const split = reconcileCopiedFieldValues({
    // Parked first so a returning value keeps its place in the order, and a
    // LIVE value of the same key wins — the live one is what the user last
    // typed, and the park is where a copy of it went to wait.
    fieldValues: {
      ...Object.fromEntries(parked.map((item) => [item.key, item.value])),
      ...asFieldValues(args.fieldValues),
    },
    // A parked item describes itself; the old type's definitions describe
    // everything still live. `fromDefs` wins a tie, because a key that is both
    // live and parked is live under the type we are leaving.
    senderDefs: [
      ...parked
        .filter((item) => !fromDefs.some((def) => def.key === item.key))
        .map(parkedItemAsDef),
      ...fromDefs,
    ],
    recipientDefs: toDefs,
  });
  return { fieldValues: split.fieldValues, foreignFields: split.foreignFields };
}

/** A parked value read back as the definition it describes — the shape it was
 *  written in, minus the value. `type` is widened to `string` in storage (the
 *  column is JSON and outlives the code that wrote it), so it is narrowed here
 *  at the one place that needs it to be a definition. */
function parkedItemAsDef(item: ForeignFieldValue): TripLogCustomFieldDef {
  return {
    key: item.key,
    label: item.label,
    type: item.type as TripLogCustomFieldDef["type"],
    ...(item.min != null ? { min: item.min } : {}),
    ...(item.max != null ? { max: item.max } : {}),
  };
}
