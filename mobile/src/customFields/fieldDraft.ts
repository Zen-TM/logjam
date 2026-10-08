// What the attribute form opens with, and when it starts over. Apart from the
// form so it can be tested: the form is a hook that is never unmounted between
// opens, so "which draft is this" is a decision, not a side effect of mounting.
import type {
  CustomFieldEntity,
  ScopedCustomFieldDef,
  TripLogCustomFieldType,
} from "@logjam/shared";

/** Everything the form holds while it is being filled in. */
export type FieldDraft = {
  label: string;
  type: TripLogCustomFieldType;
  bounded: boolean;
  min: string;
  max: string;
  appliesToAll: boolean;
  /** Place type ids for a place field, trip types (tags) for a trip field. */
  typeIds: string[];
};

/**
 * The identity of what the form is editing: a change in it re-seeds the draft.
 *
 * A NEW attribute's identity includes the place type it was opened from. With
 * one constant key for every "new", the draft seeded on the place form's first
 * render (a Canyon) was still the draft after the user switched the place to a
 * type they had just made, so the attribute was added to Canyon instead.
 */
export function fieldFormKey(
  editing: ScopedCustomFieldDef | null,
  initialTypeId: string | undefined,
): string {
  return editing ? `edit:${editing.key}` : `new:${initialTypeId ?? ""}`;
}

/** The draft a given definition opens with. A NEW field opened from a place's
 *  own form starts scoped to that type — the user asked for it while filling in
 *  a canyon — and from Settings starts on all of them, where the answer is
 *  genuinely theirs to make. */
export function seedDraft(
  entity: CustomFieldEntity,
  editing: ScopedCustomFieldDef | null,
  initialTypeId: string | undefined,
): FieldDraft {
  return {
    label: editing?.label ?? "",
    type: editing?.type ?? "string",
    bounded: editing?.min != null,
    min: editing?.min != null ? String(editing.min) : "",
    max: editing?.max != null ? String(editing.max) : "",
    appliesToAll: editing ? editing.appliesToAllTypes : initialTypeId == null,
    typeIds: editing
      ? entity === "place"
        ? editing.placeTypeIds
        : editing.tripTypes
      : initialTypeId != null
        ? [initialTypeId]
        : [],
  };
}
