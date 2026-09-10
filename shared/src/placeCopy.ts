// Copying a place someone else owns, and what happens to the values on it.
//
// The problem the whole module exists for: a copied place carries values keyed
// by the SENDER's field definitions, which the recipient may not have. Four
// ways of dealing with that were rejected before this one (plan §2.6) — and
// each rejection is a rule here, so re-litigating it would show up as a failing
// test rather than as a discussion:
//
//   * Auto-creating the missing definitions on the recipient's type would let a
//     per-PLACE action mutate a per-USER schema: copying one campsite would
//     change the form on all forty of the recipient's campsites.
//   * Appending "field: value" into `notes` is a one-way door (prose cannot be
//     turned back into values), corrupts the one field the user writes freely,
//     leaves the value permanently unfilterable, and — because place-level
//     notes are sharee-visible — propagates the machine text on re-share.
//   * Co-ownership would need conflict resolution between two accounts that
//     both go offline; "a sharee is strictly read-only" is the sync engine's
//     biggest simplification.
//   * A "Copied" tab of typeless places grows a null-type branch in every
//     screen, filter, map layer and tab bar.
//
// So a value the recipient has no definition for is parked, SELF-DESCRIBING, in
// `foreignFields` — the same shape a shared delta row carries as
// `fieldDefsSnapshot`. One shape, two uses, which is why this is not a third
// field mechanism. The user decides later, per item, with full context.
//
// PURE. The database work (loading the definitions, resolving the type,
// writing the row) belongs to the API; what is decided here is decided the same
// way on every path, and can be tested without one.

import { asFieldValues, type FieldValues, type ForeignFieldValue } from "./fieldValues.js";
import { isInternalFieldValueKey } from "./placeTypes.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

/**
 * Split an incoming place's values into what the recipient can hold and what
 * has to be parked.
 *
 * Rule 3 of §2.6: an incoming key that exists on the recipient WITH THE SAME
 * TYPE is reused, and the value lands in the right field silently. Anything
 * else goes to `foreignFields`, described by the SENDER's definition so it can
 * be rendered — and adopted — without it.
 *
 * The type check is not fussiness. A key match alone would drop the sender's
 * `"3"` into the recipient's integer field, where every numeric filter and
 * every bound check then reads a string; the value would be invisible to the
 * filter that should find it and unfixable through a form that will not accept
 * it. Parking it keeps it visible and adoptable.
 *
 * INTERNAL KEYS (`_sources` today) are carried across untouched:
 * they are not user fields, no definition describes them, and they are exactly
 * the provenance a copy should keep. `_`-prefixed keys cannot collide with a
 * user key, because `makeCustomFieldKey` cannot produce one.
 *
 * A value that is `null` or `undefined` is dropped rather than parked: missing
 * and null are the same thing (fieldValues.ts), and parking one would show the
 * recipient an empty foreign field with an action list.
 */
export function reconcileCopiedFieldValues(args: {
  /** The place being copied, as its owner stored it. */
  fieldValues: unknown;
  /** The definitions in force for the SENDER's type — what the keys mean. */
  senderDefs: readonly TripLogCustomFieldDef[];
  /** The definitions in force for the type the copy will land in. */
  recipientDefs: readonly TripLogCustomFieldDef[];
}): { fieldValues: FieldValues; foreignFields: ForeignFieldValue[] } {
  const source = asFieldValues(args.fieldValues);
  const senderByKey = new Map(args.senderDefs.map((def) => [def.key, def]));
  const recipientByKey = new Map(args.recipientDefs.map((def) => [def.key, def]));

  const fieldValues: FieldValues = {};
  const foreignFields: ForeignFieldValue[] = [];

  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    if (isInternalFieldValueKey(key)) {
      fieldValues[key] = value;
      continue;
    }
    const senderDef = senderByKey.get(key);
    const recipientDef = recipientByKey.get(key);
    if (recipientDef && (!senderDef || recipientDef.type === senderDef.type)) {
      fieldValues[key] = value;
      continue;
    }
    // No definition on EITHER side is still a value the user typed once. It is
    // described by its own key rather than dropped — the alternative is
    // deleting data because the schema drifted.
    foreignFields.push({
      key,
      label: senderDef?.label ?? key,
      type: senderDef?.type ?? "string",
      ...(senderDef?.min != null ? { min: senderDef.min } : {}),
      ...(senderDef?.max != null ? { max: senderDef.max } : {}),
      value,
    });
  }

  return { fieldValues, foreignFields };
}

/**
 * The recipient's type for a copy, by NAME.
 *
 * Rule 1 of §2.6, and the ordering is the whole point: a sender's own type
 * called "Campsite" must land on the recipient's SYSTEM Campsite rather than
 * creating a second, user-owned one beside it. Branching on the sender's type
 * KIND instead would do exactly that, and the recipient would end up with two
 * Campsite tabs — while the zero-places self-heal never fires, because the copy
 * just put a place in the new one.
 *
 * Returns null when nothing matches, which the caller reads as "create a user
 * type named after the sender's". Case-insensitive, because "campsite" and
 * "Campsite" are one category to a person.
 */
export function matchPlaceTypeByName<T extends { id: string; name: string; ownerId: string | null }>(
  senderTypeName: string,
  candidates: readonly T[],
): T | null {
  const needle = senderTypeName.trim().toLowerCase();
  if (!needle) return null;
  const named = candidates.filter((type) => type.name.trim().toLowerCase() === needle);
  return (
    named.find((type) => type.ownerId === null) ?? named[0] ?? null
  );
}

/**
 * Values stranded by a place-type CHANGE, folded into what the row already
 * parks.
 *
 * A type change is the second (and last) writer of `foreignFields`, and unlike
 * a copy it APPENDS: the row keeps its owner, so what was parked by an earlier
 * change or an earlier copy is still theirs to adopt. Keyed, with the newest
 * entry winning — retyping a place twice must not leave two rows for one key,
 * both offering "Add to my type" and only one of them right.
 *
 * Order is oldest-first so the section reads as a history rather than shuffling
 * on every change.
 */
export function mergeForeignFields(
  existing: readonly ForeignFieldValue[] | null | undefined,
  incoming: readonly ForeignFieldValue[],
): ForeignFieldValue[] {
  const byKey = new Map<string, ForeignFieldValue>();
  for (const item of existing ?? []) byKey.set(item.key, item);
  for (const item of incoming) byKey.set(item.key, item);
  return [...byKey.values()];
}

/** Whatever the database handed back, as foreign fields — tolerant, because
 *  the column is JSON and outlives the code that wrote it. A malformed entry
 *  is skipped rather than throwing: this is read on a detail screen, and one
 *  bad row must not take the screen down. */
export function asForeignFields(value: unknown): ForeignFieldValue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ForeignFieldValue =>
      item != null &&
      typeof item === "object" &&
      typeof (item as ForeignFieldValue).key === "string" &&
      typeof (item as ForeignFieldValue).label === "string" &&
      typeof (item as ForeignFieldValue).type === "string" &&
      "value" in (item as object),
  );
}
