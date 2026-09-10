// Where this install keeps its custom-field DEFINITIONS — which is now the
// same answer for everyone: the local mirror (`custom_field_defs` in
// `logjam.db`), written through the outbox like every other thing the user
// makes.
//
// This file used to branch on account state. A LINKED install kept its
// definitions on the user record (`uiPreferences`), which made editing them
// online-only — a JSON array on the user row has no id, no updatedAt and no
// tombstone, so an offline queue would have had nothing to merge with. A GUEST
// kept a second, private list in `sync_state`, and `adoptLocalFieldDefs` had to
// carry it up on link. Definitions are rows now, so both halves are gone:
// defining, renaming and deleting a field works with no signal for anyone, and
// a guest's definitions reach their new account the same way their places do
// — the outbox flushes.
//
// The VALUES were always local for both, and still are.
//
// PRIVACY: field labels are user-authored ("water level", "car shuttle"). They
// live in the mirror, which means they are inside the sign-out wipe derived
// from SYNC_TABLES — the privacy boundary between two users of one phone. That
// is precisely why they must not be kept anywhere else. Nothing here logs one.
import {
  customFieldDefFromRow,
  type CustomFieldEntity,
  type ScopedCustomFieldDef,
  asFieldValues,
  fieldValue,
  setFieldValues,
} from "@logjam/shared";

import { listMirrorPlaces, listMirrorCustomFieldDefs, listMirrorTrips } from "../sync/mirrorStore";
import {
  createCustomFieldDefLocal,
  deleteCustomFieldDefLocal,
  updatePlaceLocal,
  updateCustomFieldDefLocal,
  updateTripLocal,
} from "../sync/outbox";

/**
 * The definitions in force for this install, for one entity — WITH their
 * scoping, which is what makes `defsForType` usable on the phone.
 *
 * `customFieldDefsFromRows` drops `placeTypeIds`/`appliesToAllTypes` (a
 * `TripLogCustomFieldDef` has no room for them), and a form built from that
 * shape can only render every place field on every type — a campsite asking
 * for a V grade, which is the thing this rework exists to stop. Same
 * flatMap-with-scoping the server does in `loadScopedDefs`.
 *
 * Order is the row order the user arranged. Sorted HERE as well as in the
 * query: it is the property the form depends on, and a reader that relies on
 * someone else's ORDER BY has no way to fail when that clause changes.
 */
export async function loadFieldDefs(
  entity: CustomFieldEntity,
): Promise<ScopedCustomFieldDef[]> {
  const rows = await listMirrorCustomFieldDefs();
  return rows
    .filter((row) => row.entity === entity)
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
    .flatMap((row) => {
      const def = customFieldDefFromRow(row);
      // A row that cannot become a definition is skipped rather than
      // half-rendered — the same tolerance the server applies.
      if (!def) return [];
      return [
        {
          ...def,
          // NULL = a system definition. Carried so the editor can refuse to
          // rename or delete one: the local half of a delete strips the value
          // off every place with that key, and the server no-ops the other
          // half, so offering the verb destroyed data and reported success.
          ownerId: row.ownerId,
          placeTypeIds: row.placeTypeIds,
          appliesToAllTypes: row.appliesToAllTypes,
        },
      ];
    });
}

/**
 * Reconcile the whole list for one entity against what is stored: add what is
 * new, update what changed, delete what the caller dropped.
 *
 * The editor hands over a whole list because that is what it edits, but the
 * WRITES underneath are per-row — which is the point of the move. Two devices
 * that each add a field now both keep it, where a whole-list PATCH would have
 * let the later one erase the earlier.
 *
 * Rows are matched by `key`, which is stable across a rename, so relabelling a
 * field updates it in place and its stored values stay attached.
 */
export async function saveFieldDefs(
  entity: CustomFieldEntity,
  defs: ScopedCustomFieldDef[],
): Promise<void> {
  const rows = (await listMirrorCustomFieldDefs()).filter(
    (row) => row.entity === entity,
  );
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const incomingKeys = new Set(defs.map((def) => def.key));

  for (const row of rows) {
    // A system row is never the caller's to delete, whatever the list says.
    // The editor refuses the verb; this is the belt to that braces, because
    // the local half of a delete is destructive and runs before the server
    // ever sees the op.
    if (row.ownerId === null) continue;
    if (!incomingKeys.has(row.key)) await removeFieldDefById(row.id, entity, row.key);
  }

  for (const [position, def] of defs.entries()) {
    const row = byKey.get(def.key);
    if (!row) {
      // The scoping travels WITH the create. A definition created with neither
      // `placeTypeIds` nor `appliesToAllTypes` appears on NO form — the editor
      // is what decides which, and it has to say so here or the field the user
      // just made is invisible on the form they made it from.
      await createCustomFieldDefLocal({
        entity,
        def,
        placeTypeIds: def.placeTypeIds,
        appliesToAllTypes: def.appliesToAllTypes,
      });
      continue;
    }
    // Same rule for an edit: a built-in field's label, bounds and scoping are
    // not this account's to move, and the push would 404 and park a sync issue.
    if (row.ownerId === null) continue;
    const patch: Record<string, unknown> = {};
    if (row.label !== def.label) patch.label = def.label;
    if (row.type !== def.type) patch.type = def.type;
    if (row.min !== (def.min ?? null)) patch.min = def.min ?? null;
    if (row.max !== (def.max ?? null)) patch.max = def.max ?? null;
    if (row.position !== position) patch.position = position;
    if (row.appliesToAllTypes !== def.appliesToAllTypes) {
      patch.appliesToAllTypes = def.appliesToAllTypes;
    }
    if (!sameKeySet(row.placeTypeIds, def.placeTypeIds)) {
      patch.placeTypeIds = def.placeTypeIds;
    }
    if (Object.keys(patch).length > 0) {
      await updateCustomFieldDefLocal(row.id, patch);
    }
  }
}

/** Set equality over two id lists — order is not meaningful in a scoping. */
function sameKeySet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/**
 * How many rows carry a value for this field — the number the delete
 * confirmation quotes before the user commits.
 *
 * Counted from the local mirror, which is complete for the rows this user owns
 * (the delta pull is unbounded, not a window). It can still be BEHIND: a trip
 * logged in the browser since the last pull is not counted. That is a stale
 * number rather than a wrong one, and it is the honest one to show — the
 * alternative is withholding the count from an offline user entirely.
 */
export async function countFieldValues(
  entity: CustomFieldEntity,
  key: string,
): Promise<number> {
  return (await rowsWithFieldValue(entity, key)).length;
}

/**
 * Delete a definition AND strip the orphaned values off every local row that
 * carried one, resolving with how many rows lost a value.
 *
 * The local strip goes through the normal outbox update paths so the clearing
 * reaches the server too — but the SERVER also runs its own strip when the
 * delete op lands (`api/src/lib/customFieldDefs.ts`), because this phone can
 * only reach rows in its own mirror. A row the phone has not pulled would
 * otherwise keep its value and resurface it under a later field with the same
 * slug. The two strips agree, and the server's is the complete one.
 */
export async function removeFieldDef(
  entity: CustomFieldEntity,
  key: string,
): Promise<number> {
  const row = (await listMirrorCustomFieldDefs()).find(
    (candidate) => candidate.entity === entity && candidate.key === key,
  );
  if (!row) return 0;
  // The one that mattered: deleting a built-in stripped its value off every
  // place in the account, and the server answered the def delete with
  // "already applied" — so the definition came back on the next pull and the
  // values did not.
  if (row.ownerId === null) {
    throw new Error("A built-in field can't be deleted.");
  }
  return removeFieldDefById(row.id, entity, key);
}

async function removeFieldDefById(
  id: string,
  entity: CustomFieldEntity,
  key: string,
): Promise<number> {
  const rows = await rowsWithFieldValue(entity, key);
  for (const row of rows) {
    if (entity === "tripLog") {
      const remaining = { ...row.values };
      delete remaining[key];
      await updateTripLocal(row.id, { customFields: remaining });
    } else {
      // `setFieldValues` removes the key and leaves everything else — including
      // the internal `_sources` entry, which lives in the same object now
      // rather than beside it. Rebuilding the object by hand here would drop
      // it.
      await updatePlaceLocal(row.id, {
        fieldValues: setFieldValues(row.values, { [key]: null }),
      });
    }
  }
  await deleteCustomFieldDefLocal(id);
  return rows.length;
}

/**
 * The local rows carrying a value for `key`. Reads the whole table and filters
 * in JS rather than reaching for `json_extract`: a field key is user-derived
 * text, and a device's own library is hundreds of rows, not millions.
 */
async function rowsWithFieldValue(
  entity: CustomFieldEntity,
  key: string,
): Promise<{ id: string; values: Record<string, unknown> }[]> {
  if (entity === "tripLog") {
    const trips = await listMirrorTrips();
    return trips
      .filter((trip) => trip.customFields?.[key] !== undefined)
      .map((trip) => ({ id: trip.id, values: trip.customFields ?? {} }));
  }
  const places = await listMirrorPlaces();
  return places
    // A place shared WITH this user is read-only, and its owner's fields are
    // not this user's to strip.
    .filter(
      (place) =>
        place.syncRole === "owner" &&
        fieldValue(place.fieldValues, key) !== undefined,
    )
    .map((place) => ({
      id: place.id,
      values: asFieldValues(place.fieldValues),
    }));
}
