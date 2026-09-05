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
// a guest's definitions reach their new account the same way their canyons do
// — the outbox flushes.
//
// The VALUES were always local for both, and still are.
//
// PRIVACY: field labels are user-authored ("water level", "car shuttle"). They
// live in the mirror, which means they are inside the sign-out wipe derived
// from SYNC_TABLES — the privacy boundary between two users of one phone. That
// is precisely why they must not be kept anywhere else. Nothing here logs one.
import {
  customFieldDefsFromRows,
  type CustomFieldEntity,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import type { TCanyonAttributes } from "../api/types";
import { listMirrorCanyons, listMirrorCustomFieldDefs, listMirrorTrips } from "../sync/mirrorStore";
import {
  createCustomFieldDefLocal,
  deleteCustomFieldDefLocal,
  updateCanyonLocal,
  updateCustomFieldDefLocal,
  updateTripLocal,
} from "../sync/outbox";

/** The definitions in force for this install, for one entity. */
export async function loadFieldDefs(
  entity: CustomFieldEntity,
): Promise<TripLogCustomFieldDef[]> {
  return customFieldDefsFromRows(await listMirrorCustomFieldDefs(), entity);
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
  defs: TripLogCustomFieldDef[],
): Promise<void> {
  const rows = (await listMirrorCustomFieldDefs()).filter(
    (row) => row.entity === entity,
  );
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const incomingKeys = new Set(defs.map((def) => def.key));

  for (const row of rows) {
    if (!incomingKeys.has(row.key)) await removeFieldDefById(row.id, entity, row.key);
  }

  for (const [position, def] of defs.entries()) {
    const row = byKey.get(def.key);
    if (!row) {
      await createCustomFieldDefLocal({ entity, def });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (row.label !== def.label) patch.label = def.label;
    if (row.type !== def.type) patch.type = def.type;
    if (row.min !== (def.min ?? null)) patch.min = def.min ?? null;
    if (row.max !== (def.max ?? null)) patch.max = def.max ?? null;
    if (row.position !== position) patch.position = position;
    if (Object.keys(patch).length > 0) {
      await updateCustomFieldDefLocal(row.id, patch);
    }
  }
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
  return removeFieldDefById(row.id, entity, key);
}

async function removeFieldDefById(
  id: string,
  entity: CustomFieldEntity,
  key: string,
): Promise<number> {
  const rows = await rowsWithFieldValue(entity, key);
  for (const row of rows) {
    const remaining = { ...row.values };
    delete remaining[key];
    if (entity === "tripLog") {
      await updateTripLocal(row.id, { customFields: remaining });
    } else {
      await updateCanyonLocal(row.id, {
        attributes: { ...row.attributes, customFields: remaining },
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
): Promise<
  { id: string; values: Record<string, unknown>; attributes: TCanyonAttributes }[]
> {
  if (entity === "tripLog") {
    const trips = await listMirrorTrips();
    return trips
      .filter((trip) => trip.customFields?.[key] !== undefined)
      .map((trip) => ({ id: trip.id, values: trip.customFields ?? {}, attributes: {} }));
  }
  const canyons = await listMirrorCanyons();
  return canyons
    // A canyon shared WITH this user is read-only, and its owner's fields are
    // not this user's to strip.
    .filter(
      (canyon) =>
        canyon.syncRole === "owner" &&
        canyon.attributes?.customFields?.[key] !== undefined,
    )
    .map((canyon) => ({
      id: canyon.id,
      values: canyon.attributes?.customFields ?? {},
      attributes: canyon.attributes ?? {},
    }));
}
