// `isReservedFieldKey` only — placeTypes.ts imports this module for a TYPE,
// which is erased, so this edge does not close a runtime cycle.
import { isReservedFieldKey } from "./placeTypes.js";

/**
 * The two surfaces a custom field can belong to. One declaration for the API's
 * table column, the sync protocol, the mobile store and the web dialogs — it
 * used to be spelled separately in `mobile/src/api/queries.ts` and in the
 * `entityConfigs` of `api/src/routes/customFields.ts`.
 *
 * `"place"` stays ONE entity after the places rework rather than splitting per
 * place type: scoping a definition to types is a separate axis, carried by
 * `CustomFieldDefPlaceType` plus the `appliesToAllTypes` flag, precisely so a
 * field key means the same thing wherever it appears in one owner's namespace.
 * These remain the only two values `CustomFieldDef.entity` may hold, and
 * `isCustomFieldEntity` is the gate that says so.
 */
export const CUSTOM_FIELD_ENTITIES = ["tripLog", "place"] as const;

export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export function isCustomFieldEntity(value: unknown): value is CustomFieldEntity {
  return CUSTOM_FIELD_ENTITIES.includes(value as CustomFieldEntity);
}

/**
 * What a user's own field is CALLED, everywhere a user can read it, on BOTH
 * clients.
 *
 * "Field" is form jargon — it names the box, not the thing the box records — so
 * the UI says "attribute" and the code keeps saying field (the column, the
 * table, the sync entity and every function in this file). One constant rather
 * than forty string literals, so the next rename is one line and cannot leave
 * half of one client behind — which is what happened the first time: the phone
 * was renamed during the places rework and Logjam Web kept saying "Custom trip
 * fields" and "Add field" for another three months.
 */
export const ATTRIBUTE_NOUN = {
  one: "attribute",
  many: "attributes",
  /** Carried rather than composed: "a"/"an" does not follow from the noun, and
   *  a rename that leaves "a attribute" behind is the classic way this kind of
   *  constant half-works. */
  add: "Add an attribute",
} as const;

export type TripLogCustomFieldType =
  | "string"
  | "integer"
  | "float"
  | "date"
  | "boolean";

export type TripLogCustomFieldDef = {
  key: string;
  label: string;
  type: TripLogCustomFieldType;
  // Optional inclusive bounds, only meaningful (and only valid) for
  // integer/float fields. EITHER, NEITHER OR BOTH — min-only is how every
  // "how many" field is bounded, because there is no honest ceiling for it.
  // The place filter renders a double-ended range slider only when both are
  // present, and falls back to op+value otherwise.
  min?: number;
  max?: number;
};

/**
 * A definition WITH its scoping — which types it applies to, and whether it
 * applies to every one of them including types created later.
 *
 * Separate from `TripLogCustomFieldDef` rather than folded into it, because the
 * scoping answers a different question from the field itself: dozens of call
 * sites want "what shape is this value" and only the form builders and the
 * field editor want "where does it appear". The plain shape is what a value
 * renderer, a filter and a validator take; this one is what decides which
 * fields a form has at all.
 *
 * TWO KINDS OF TYPE, ONE PER ENTITY. A place field is scoped to PLACE TYPES
 * (`placeTypeIds`, rows with ids); a trip field is scoped to TRIP TYPES
 * (`tripTypes`, the free-text tags a trip carries — "canyoning",
 * "packrafting"). The other list is always empty, and the API refuses a write
 * that fills it. A trip is scoped by its tags and not by the places it links
 * because a trip is often logged with no place at all — a casual walk up a
 * popular track nobody needs to save — and the tags are what say what the user
 * was actually doing.
 *
 * `appliesToAllTypes` is a FLAG rather than join rows for every type that
 * exists today: rows would silently fail to apply to a type created tomorrow,
 * and the user who ticked "All" would never find out. For a trip field it
 * means every trip, tagged or not.
 */
export type ScopedCustomFieldDef = TripLogCustomFieldDef & {
  placeTypeIds: string[];
  /**
   * Trip types, compared CASE-INSENSITIVELY and stored in the casing the user
   * picked. Plain strings because trip types are not rows: nothing renames a
   * tag, so a string match cannot drift.
   */
  // ponytail: string match on free-text tags. If a tag rename is ever added it
  // must rewrite these in the same transaction, or the attribute silently stops
  // appearing on the renamed trips.
  tripTypes: string[];
  appliesToAllTypes: boolean;
  /**
   * WHOSE definition this is. NULL means a SYSTEM one — the seven canyon axes,
   * the campsite's two — global rows belonging to no account, which no user may
   * rename or delete.
   *
   * A form builder needs it because the alternative is offering verbs the
   * server refuses: on the phone that was worse than an error, because the
   * local half of a delete (strip the value off every place carrying the key)
   * ran before the server no-opped the other half.
   *
   * Optional so a definition assembled by an older client or a test is still a
   * definition; absent reads as "not a system row", which is the safe
   * direction — it offers the verbs, and the server still refuses.
   */
  ownerId?: string | null;
};

/**
 * A built-in: not renameable, not deletable.
 *
 * BOTH HALVES ARE LOAD-BEARING. `ownerId === null` is the server's answer and
 * was once the whole test — but a definition created on the phone has no owner
 * id until the server sends one back, because the local INSERT has no column
 * for it. So a field the user had just added rendered with a padlock and no
 * verbs for the few seconds until the next delta landed, which reads as the app
 * refusing to let you edit your own field.
 *
 * The key settles it offline: `RESERVED_FIELD_KEYS` is derived from
 * `SYSTEM_FIELD_DEFS`, so every built-in's key is reserved by construction, and
 * `assertKeyNotReserved` refuses a reserved key on create AND on rename for
 * BOTH entities — so no definition a user can make will ever have one. The test
 * is therefore exact rather than a heuristic, and it works with no account and
 * no signal, which is the same standard the rest of this file holds to.
 *
 * `ownerId === undefined` (an older client, a test) still reads as "not a
 * built-in": it offers the verbs, and the server still refuses.
 */
export function isSystemFieldDef(def: ScopedCustomFieldDef): boolean {
  return def.ownerId === null && isReservedFieldKey(def.key);
}

/** The definitions a place of `placeTypeId` shows, in the order given. The one
 *  rule both clients apply to build a form, so a phone and a browser cannot
 *  disagree about which fields a campsite has. */
export function defsForType(
  defs: readonly ScopedCustomFieldDef[],
  placeTypeId: string,
): ScopedCustomFieldDef[] {
  return defs.filter(
    (def) => def.appliesToAllTypes || def.placeTypeIds.includes(placeTypeId),
  );
}

/**
 * The definitions a TRIP's form shows: the ones scoped to the trip's own TYPES
 * (its tags), UNION any key that already has a value, UNION any key the caller
 * says to keep.
 *
 * A packrafting trip is asked the packrafting questions; an untagged one is
 * asked only the `appliesToAllTypes` ones. Tags match case-insensitively, the
 * same way the API dedupes them.
 *
 * THE UNION CLAUSES ARE WHAT STOP IT EATING DATA. Both clients save exactly the
 * fields the form shows, so a field that stops rendering loses its value on the
 * next save:
 *  - `values` covers what is STORED — untagging the trip or rescoping a
 *    definition would otherwise hide a recorded answer.
 *  - `keep` covers what is being TYPED — the stored values say nothing about an
 *    unsaved edit, so ticking packrafting, typing a river level and unticking it
 *    again would drop the answer. The form passes the keys edited since it
 *    opened. Keyed on EDITED rather than on "has a value right now", or
 *    backspacing to empty would unmount the field under the cursor.
 * A value is destroyed only by clearing it, or by deleting its definition,
 * which has its own impact count and confirmation.
 *
 * Order is the order given, so a field does not jump when a tag is toggled.
 */
export function tripFieldDefs(
  defs: readonly ScopedCustomFieldDef[],
  tripTypes: readonly string[],
  values: Record<string, unknown> | null | undefined,
  keep?: ReadonlySet<string>,
): ScopedCustomFieldDef[] {
  const tagged = new Set(tripTypes.map((type) => type.toLowerCase()));
  return defs.filter(
    (def) =>
      def.appliesToAllTypes ||
      def.tripTypes.some((type) => tagged.has(type.toLowerCase())) ||
      (values != null && values[def.key] !== undefined && values[def.key] !== null) ||
      (keep?.has(def.key) ?? false),
  );
}

/**
 * The widest span that still reads as a rail rather than a ruler.
 *
 * A bounded integer is drawn as a row of stops instead of a number box, which
 * is how the canyon grades have always been drawn — they just used to be seven
 * hand-written controls (`PlaceEditSheet` on the phone, `PlaceDialog` on the
 * web) with their keys spelled out. They are ordinary bounded integers, so the
 * rail is a property of the TYPE and every field that shares that shape gets
 * it: a user's own "Difficulty, 1-5" is drawn exactly like the V grade,
 * without knowing anything about canyons.
 *
 * Above this the stops stop being tappable and a keyboard is faster. `hours`
 * and `num_abseils` are unbounded and were never rail candidates.
 */
const MAX_RAIL_STOPS = 12;

/**
 * The stops a bounded integer draws, or null when it is not rail-shaped.
 *
 * Derived from the definition's own bounds, which is the only place they are
 * declared — a rail that restated 1-7 would drift from the field it draws.
 * Shared rather than per-client: the phone had this first (as
 * `mobile/src/customFields/fieldValueCoercion.ts`) and a second copy for the
 * browser is the "two lists that must agree" failure in miniature — the web
 * would keep drawing a V grade as a number box the day the phone widened the
 * cap.
 */
export function railStops(def: TripLogCustomFieldDef): number[] | null {
  if (def.type !== "integer") return null;
  if (def.min == null || def.max == null) return null;
  const span = def.max - def.min;
  if (span < 1 || span + 1 > MAX_RAIL_STOPS) return null;
  const stops: number[] = [];
  for (let stop = def.min; stop <= def.max; stop += 1) stops.push(stop);
  return stops;
}

export const CUSTOM_FIELD_TYPES: {
  value: TripLogCustomFieldType;
  label: string;
}[] = [
  { value: "string", label: "Text" },
  { value: "integer", label: "Integer" },
  { value: "float", label: "Decimal" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
];

export const VALID_CUSTOM_FIELD_TYPES = new Set<string>([
  "string",
  "integer",
  "float",
  "date",
  "boolean",
]);

/**
 * Display label for a custom field. Bounded integer/float fields get their
 * range appended in brackets (e.g. "Temperature (1-5)") so the constraint is
 * visible everywhere the field is shown, without polluting the stored label.
 */
export function customFieldDisplayLabel(def: TripLogCustomFieldDef): string {
  // One-sided bounds get shown too. This used to require BOTH, so a min-only
  // field — which every "how many" field now is — displayed with no hint that
  // it was bounded at all, and the user only found out when a write was
  // refused.
  if (def.min != null && def.max != null) {
    return `${def.label} (${def.min}-${def.max})`;
  }
  if (def.min != null) return `${def.label} (${def.min}+)`;
  if (def.max != null) return `${def.label} (up to ${def.max})`;
  return def.label;
}

export function makeCustomFieldKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function coerceFieldValue(value: string, type: TripLogCustomFieldType): unknown {
  if (value === "") return null;
  if (type === "integer") return parseInt(value, 10);
  if (type === "float") return parseFloat(value);
  if (type === "boolean") return value === "true";
  return value;
}

/**
 * Strict sibling of `coerceFieldValue`. Instead of silently producing `NaN`
 * for a malformed numeric string (which `parseInt`/`parseFloat` do), it reports
 * success/failure so callers can fail loudly. An empty string is a legitimate
 * "unset" and succeeds with `value: null`. Integer fields reject any input that
 * isn't a whole number (e.g. "5.5"); float fields reject non-finite input.
 *
 * `coerceFieldValue` is retained for the existing edit paths (which pre-validate
 * via `customFieldValueError` before saving); this variant exists for import /
 * programmatic paths that have no separate validation gate.
 */
export function coerceFieldValueStrict(
  value: string,
  type: TripLogCustomFieldType,
): { ok: true; value: unknown } | { ok: false } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (type === "integer") {
    if (!/^[+-]?\d+$/.test(trimmed)) return { ok: false };
    const parsed = parseInt(trimmed, 10);
    if (!Number.isSafeInteger(parsed)) return { ok: false };
    return { ok: true, value: parsed };
  }
  if (type === "float") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return { ok: false };
    return { ok: true, value: parsed };
  }
  if (type === "boolean") return { ok: true, value: trimmed === "true" };
  return { ok: true, value };
}

/**
 * True when a trip log's stored `customFields` blob carries a meaningful value
 * for `key` — i.e. the key is present and not null/empty-string. Used for the
 * "N trips carry a value for this field" impact warnings shown before a custom
 * field is renamed or deleted, and to decide which trip rows to rewrite on
 * delete. Pure.
 */
export function tripLogHasCustomFieldValue(
  customFields: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  if (customFields == null) return false;
  const value = customFields[key];
  return value !== undefined && value !== null && value !== "";
}

/**
 * Count how many of `trips` carry a value for the custom field `key`. Drives
 * the impact warning on rename/delete. Pure.
 */
export function countTripLogsWithCustomField(
  trips: { customFields: Record<string, unknown> | null | undefined }[],
  key: string,
): number {
  let count = 0;
  for (const trip of trips) {
    if (tripLogHasCustomFieldValue(trip.customFields, key)) count += 1;
  }
  return count;
}

/**
 * Rename a custom field's display label while keeping its `key` stable, so the
 * values already stored on trip logs (keyed by `key`) stay linked — a rename
 * must never orphan existing values. Pure: returns the new defs array or a
 * user-facing error string. The key is deliberately NOT re-derived from the new
 * label (doing so would orphan every stored value).
 */
export function renameCustomFieldLabel(
  defs: TripLogCustomFieldDef[],
  key: string,
  newLabel: string,
): { defs: TripLogCustomFieldDef[] } | { error: string } {
  const label = newLabel.trim();
  if (!label) return { error: "Label is required." };
  const target = defs.find((d) => d.key === key);
  if (!target) return { error: "That field no longer exists." };
  if (target.label === label) return { defs };
  return {
    defs: defs.map((d) => (d.key === key ? { ...d, label } : d)),
  };
}

/**
 * Raw form state for the "Add Custom Field" sub-form. Both PlaceDialog and
 * TripLogDialog feed this into `buildCustomFieldDef` to get a validated
 * `TripLogCustomFieldDef` or a user-facing error string.
 */
export type CustomFieldDraft = {
  label: string;
  type: TripLogCustomFieldType;
  bounded: boolean;
  min: string;
  max: string;
};

/**
 * Validate a custom-field draft and produce a `TripLogCustomFieldDef` ready
 * for persistence, or a user-facing error string. Pure — no side effects.
 */
export function buildCustomFieldDef(
  draft: CustomFieldDraft,
  existingDefs: TripLogCustomFieldDef[],
): { def: TripLogCustomFieldDef } | { error: string } {
  const label = draft.label.trim();
  if (!label) return { error: "Label is required." };

  const key = makeCustomFieldKey(label);
  if (existingDefs.some((d) => d.key === key)) {
    return { error: `A field with the key "${key}" already exists.` };
  }

  const isNumeric = draft.type === "integer" || draft.type === "float";
  let bounds: { min: number; max: number } | null = null;

  if (isNumeric && draft.bounded) {
    if (draft.min.trim() === "" || draft.max.trim() === "") {
      return { error: "Both min and max are required for a bounded field." };
    }
    const min =
      draft.type === "integer"
        ? parseInt(draft.min, 10)
        : parseFloat(draft.min);
    const max =
      draft.type === "integer"
        ? parseInt(draft.max, 10)
        : parseFloat(draft.max);
    if (!isFinite(min) || !isFinite(max)) {
      return { error: "Min and max must be valid numbers." };
    }
    if (min >= max) {
      return { error: "Minimum must be less than maximum." };
    }
    bounds = { min, max };
  }

  return {
    def: { key, label, type: draft.type, ...(bounds ?? {}) },
  };
}

/**
 * The persisted shape of a definition — a `custom_field_defs` row on the
 * server, a `custom_field_defs` mirror row on the phone. Structural rather
 * than imported from `sync.ts` so this module stays free of protocol types;
 * both sides satisfy it.
 */
export type CustomFieldDefRow = {
  entity: string;
  key: string;
  label: string;
  type: string;
  min: number | null;
  max: number | null;
  position: number;
};

/**
 * Row → the definition the UI works in, or null when the row does not describe
 * a usable field. Dropping rather than throwing matches what
 * `normalizeCustomFieldDefs` has always done with a malformed def: it was
 * unusable and invisible either way, and one bad row must not take out the
 * whole list.
 *
 * Bounds only survive together — a half-bounded numeric row would fail the
 * guard, so it is normalized to unbounded rather than dropped entirely.
 */
export function customFieldDefFromRow(
  row: CustomFieldDefRow,
): TripLogCustomFieldDef | null {
  // ONE-SIDED BOUNDS SURVIVE. This used to require both, so a min-only
  // definition — which every "how many" field is, and which three of the system
  // fields are — came back through this reader with no bound at all: the form
  // stopped showing the range and the client-side check stopped refusing a
  // negative, leaving the server as the only thing that still said no.
  const candidate = {
    key: row.key,
    label: row.label,
    type: row.type,
    ...(row.min != null ? { min: row.min } : {}),
    ...(row.max != null ? { max: row.max } : {}),
  };
  return isTripLogCustomFieldDef(candidate) ? candidate : null;
}

/**
 * The rows for one entity, in the order the user arranged them, as definitions.
 * `position` is the order; `key` breaks a tie so two rows that raced to the
 * same position still render in a stable order rather than swapping between
 * reads.
 */
export function customFieldDefsFromRows(
  rows: CustomFieldDefRow[],
  entity: CustomFieldEntity,
): TripLogCustomFieldDef[] {
  return rows
    .filter((row) => row.entity === entity)
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
    .map(customFieldDefFromRow)
    .filter((def): def is TripLogCustomFieldDef => def !== null);
}

export function isTripLogCustomFieldDef(v: unknown): v is TripLogCustomFieldDef {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (
    typeof c.key !== "string" ||
    c.key.length === 0 ||
    typeof c.label !== "string" ||
    c.label.length === 0 ||
    !VALID_CUSTOM_FIELD_TYPES.has(c.type as string)
  ) {
    return false;
  }
  // Bounds are optional and ONE-SIDED IS LEGAL: min alone, max alone, or both.
  //
  // They used to be both-or-neither, which the system defs cannot satisfy —
  // `hours`, `num_abseils` and `longest_abseil` are min-0-no-max, exactly as
  // the numeric constraints on the old grade columns were. Requiring both would
  // have meant inventing a ceiling for "how many pitches", which is a number
  // nobody knows and every user would eventually hit.
  //
  // Whatever is present must be a finite number of the right kind, and when
  // both are present min must be below max. Fail loud rather than silently
  // dropping — a dropped bound is a field that quietly stops validating.
  const hasMin = c.min !== undefined && c.min !== null;
  const hasMax = c.max !== undefined && c.max !== null;
  if (hasMin || hasMax) {
    if (c.type !== "integer" && c.type !== "float") return false;
    for (const bound of [hasMin ? c.min : undefined, hasMax ? c.max : undefined]) {
      if (bound === undefined) continue;
      if (typeof bound !== "number" || !Number.isFinite(bound)) return false;
      if (c.type === "integer" && !Number.isInteger(bound)) return false;
    }
    if (hasMin && hasMax && (c.min as number) >= (c.max as number)) return false;
  }
  return true;
}
