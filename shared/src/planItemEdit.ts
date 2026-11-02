// A plan item's edit form as words and as a compare-and-set body, for both
// clients (Logjam Web's PlanItemEditDialog, Logjam GPS's PlanItemSheet). Every
// word is a string as typed. A place holds its other names (comma separated),
// position, elevation and one `attr:<key>` per attribute of its system type; a
// file with no name of its own is blank, so saving untouched never writes its
// filename as its name.
import { fieldValue } from "./fieldValues.js";
import { SYSTEM_FIELD_DEFS, SYSTEM_PLACE_TYPES } from "./placeTypes.js";
import {
  coerceFieldValue,
  type TripLogCustomFieldDef,
} from "./tripLogFields.js";
import type {
  TripPlanFilePatch,
  TripPlanItem,
  TripPlanPlace,
  TripPlanPlacePatch,
  TripPlanRoutePatch,
} from "./tripPlans.js";

export type ItemWords = {
  name: string;
  notes: string;
  [field: string]: string;
};

export const ITEM_ATTR = "attr:";

/** Key order aside: JSONB hands objects back in Postgres's key order. */
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, each]) => [key, sorted(each)]),
        )
      : value;

export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** The attributes a plan place records: its system type's definitions. */
export function itemFieldDefs(
  place: Pick<TripPlanPlace, "placeTypeId">,
): TripLogCustomFieldDef[] {
  const type = SYSTEM_PLACE_TYPES.find((each) => each.id === place.placeTypeId);
  return SYSTEM_FIELD_DEFS.filter(
    (def) => type != null && def.placeTypes.includes(type.key),
  ).map(({ key, label, type, min, max }) => ({
    key,
    label,
    type,
    min: min ?? undefined,
    max: max ?? undefined,
  }));
}

export function itemWords(item: TripPlanItem): ItemWords {
  switch (item.kind) {
    case "place": {
      const words: ItemWords = {
        name: item.name,
        notes: item.notes ?? "",
        altNames: item.altNames.join(", "),
        latitude: String(item.latitude),
        longitude: String(item.longitude),
        elevation: item.elevation == null ? "" : String(item.elevation),
      };
      for (const def of itemFieldDefs(item)) {
        const raw = fieldValue(item.fieldValues, def.key);
        words[ITEM_ATTR + def.key] = raw == null ? "" : String(raw);
      }
      return words;
    }
    case "route":
      return { name: item.name, notes: "" };
    case "media":
      return { name: item.item.displayName ?? "", notes: "" };
  }
}

/**
 * An item edit's compare-and-set body, or null when nothing changed. Each
 * `from` is the stored value of `seen`, never the form's blanked words: the
 * API compares it exactly, and a stored "" is not null. A place's fields are
 * assumed valid (the form checks them first).
 */
export function itemPatch(
  seen: TripPlanItem,
  now: ItemWords,
): TripPlanPlacePatch | TripPlanRoutePatch | TripPlanFilePatch | null {
  const was = itemWords(seen);
  const name = now.name.trim();
  if (seen.kind === "media")
    return name === was.name
      ? null
      : { displayName: { from: seen.item.displayName, to: name || null } };
  const patch: TripPlanPlacePatch = {};
  if (name !== was.name) patch.name = { from: seen.name, to: name };
  if (seen.kind === "place") {
    if (now.notes !== was.notes)
      patch.notes = { from: seen.notes, to: now.notes.trim() || null };
    const altNames = now.altNames
      .split(",")
      .map((each) => each.trim())
      .filter(Boolean);
    if (!sameValue(altNames, seen.altNames))
      patch.altNames = { from: seen.altNames, to: altNames };
    const latitude = Number(now.latitude);
    const longitude = Number(now.longitude);
    if (latitude !== seen.latitude || longitude !== seen.longitude)
      patch.position = {
        from: { latitude: seen.latitude, longitude: seen.longitude },
        to: { latitude, longitude },
      };
    const elevation =
      now.elevation.trim() === "" ? null : Number(now.elevation);
    if (elevation !== seen.elevation)
      patch.elevation = { from: seen.elevation, to: elevation };
    for (const def of itemFieldDefs(seen)) {
      const to = coerceFieldValue(now[ITEM_ATTR + def.key], def.type);
      const from = fieldValue(seen.fieldValues, def.key) ?? null;
      if (!sameValue(to, from))
        (patch.fieldValues ??= {})[def.key] = { from, to };
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
