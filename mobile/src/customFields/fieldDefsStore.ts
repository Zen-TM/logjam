// Where this install keeps its custom-field DEFINITIONS — and the only place
// that knows the answer depends on whether there is an account.
//
// A LINKED install keeps them on the user record (`uiPreferences`), shared with
// the web and every other device, which is why editing them stays online-only:
// an offline queue would need merge rules for a list the user could be
// reordering in a browser at the same time.
//
// A GUEST has no user record. Their definitions live in `sync_state` — the
// local key/value table in `logjam.db` — so defining, renaming and deleting a
// field works with no signal at all, exactly like every other thing a guest
// does. The VALUES were always local for both.
//
// `sync_state` rather than `prefsDb`, deliberately: `prefsDb` is the one store
// `wipeAllLocalData` spares, because it holds statements about the HANDSET
// (theme, app lock) that must survive the phone changing hands. A field label
// is the user's own words about their canyoning, so it belongs on the side of
// that boundary that gets erased — and `wipeAllSyncData` derives its DELETEs
// from `SYNC_TABLES`, so `sync_state` is already in the wipe.
//
// Definitions are not a synced ENTITY — there is no outbox op for a user
// preference — so this is the one part of guest mode that is not simply "the
// same write path, unflushed" (mobile/CLAUDE.md). `adoptLocalFieldDefs` closes
// that gap on link: the definitions go up to the account, or the trips the
// outbox is about to push would arrive carrying values under keys nothing on
// the account can name.
//
// PRIVACY: field labels are user-authored ("water level", "car shuttle"), and a
// guest's exist only here. Nothing in this file logs one.
import { isTripLogCustomFieldDef, type TripLogCustomFieldDef } from "@logjam/shared";

import {
  customFieldDefsOf,
  deleteCustomFieldDef,
  fetchCurrentUser,
  getCustomFieldImpact,
  updateCustomFieldDefs,
  type CustomFieldEntity,
} from "../api/queries";
import type { TCanyonAttributes, TUser } from "../api/types";
import type { AccountState } from "../auth/capabilities";
import { listMirrorCanyons, listMirrorTrips } from "../sync/mirrorStore";
import { updateCanyonLocal, updateTripLocal } from "../sync/outbox";
import {
  getSyncStateValue,
  notifyMirrorChanged,
  setSyncStateValue,
} from "../sync/syncDb";

/** `sync_state` keys. Distinct from the account's `uiPreferences` names on
 *  purpose — these hold a DIFFERENT list, belonging to no account. */
const LOCAL_DEFS_KEY: Record<CustomFieldEntity, string> = {
  tripLog: "localTripLogCustomFields",
  canyon: "localCanyonCustomFields",
};

export const CUSTOM_FIELD_ENTITIES: readonly CustomFieldEntity[] = ["tripLog", "canyon"];

/**
 * Stored JSON → definitions. Throws on anything that isn't a list of valid
 * definitions rather than falling back to `[]`: an empty list reads as "you
 * never made any fields", and a user whose values silently lose their labels
 * would have no way to tell that from data loss.
 */
export function parseFieldDefs(raw: string | null): TripLogCustomFieldDef[] {
  if (raw == null || raw === "") return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isTripLogCustomFieldDef)) {
    throw new Error("Corrupt local custom field definitions");
  }
  return parsed;
}

/** This device's own definitions. Empty for an install that never made any. */
export async function readLocalFieldDefs(
  entity: CustomFieldEntity,
): Promise<TripLogCustomFieldDef[]> {
  return parseFieldDefs(await getSyncStateValue(LOCAL_DEFS_KEY[entity]));
}

/** Replace this device's definitions. Notifies so open screens re-read. */
export async function writeLocalFieldDefs(
  entity: CustomFieldEntity,
  defs: TripLogCustomFieldDef[],
): Promise<void> {
  await setSyncStateValue(LOCAL_DEFS_KEY[entity], JSON.stringify(defs));
  notifyMirrorChanged();
}

// ── the account-state-aware surface every screen calls ───────────────────────

/** The definitions in force for this install. */
export async function loadFieldDefs(
  entity: CustomFieldEntity,
  accountState: AccountState,
): Promise<TripLogCustomFieldDef[]> {
  return accountState === "guest"
    ? readLocalFieldDefs(entity)
    : customFieldDefsOf(await fetchCurrentUser(), entity);
}

/** Add, rename or retype: both paths take the WHOLE list, not a delta. */
export async function saveFieldDefs(
  entity: CustomFieldEntity,
  accountState: AccountState,
  defs: TripLogCustomFieldDef[],
): Promise<void> {
  if (accountState === "guest") {
    await writeLocalFieldDefs(entity, defs);
    return;
  }
  await updateCustomFieldDefs(entity, defs);
}

/** How many rows carry a value for this field — the number the delete
 *  confirmation quotes before the user commits. */
export async function countFieldValues(
  entity: CustomFieldEntity,
  accountState: AccountState,
  key: string,
): Promise<number> {
  return accountState === "guest"
    ? (await rowsWithFieldValue(entity, key)).length
    : getCustomFieldImpact(entity, key);
}

/**
 * Delete a definition AND strip the orphaned values off every row that carried
 * one, resolving with how many rows lost a value.
 *
 * A guest's strip goes through the normal outbox update paths, so the same
 * clearing reaches the server if they ever link — a value cleared on the phone
 * must not come back the moment the trips are pushed.
 */
export async function removeFieldDef(
  entity: CustomFieldEntity,
  accountState: AccountState,
  key: string,
  defs: TripLogCustomFieldDef[],
): Promise<number> {
  if (accountState !== "guest") return deleteCustomFieldDef(entity, key);

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
  await writeLocalFieldDefs(
    entity,
    defs.filter((def) => def.key !== key),
  );
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
    // not this user's to strip. A guest has no shares, but this function is the
    // shape both account states will use if the account path ever moves local.
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

// ── linking an account ───────────────────────────────────────────────────────

/**
 * One-shot on link: carry this phone's definitions up to the account, then drop
 * the local copy so there is only ever one list in force.
 *
 * The account's own definitions WIN on a key collision — they may already have
 * values behind them on the web, and a phone that has never seen them cannot
 * be the authority on their label or type. Local-only keys are appended.
 *
 * Nothing is cleared until the PATCH lands, so a link made in a tunnel simply
 * tries again the next time the app has the user record and a connection.
 */
export async function adoptLocalFieldDefs(user: TUser): Promise<void> {
  for (const entity of CUSTOM_FIELD_ENTITIES) {
    const local = await readLocalFieldDefs(entity);
    if (local.length === 0) continue;
    const account = customFieldDefsOf(user, entity);
    const merged = mergeFieldDefs(account, local);
    if (merged.length > account.length) await updateCustomFieldDefs(entity, merged);
    await writeLocalFieldDefs(entity, []);
  }
}

/** Account list first, then whatever keys only the phone had. */
export function mergeFieldDefs(
  account: TripLogCustomFieldDef[],
  local: TripLogCustomFieldDef[],
): TripLogCustomFieldDef[] {
  const taken = new Set(account.map((def) => def.key));
  return [...account, ...local.filter((def) => !taken.has(def.key))];
}
