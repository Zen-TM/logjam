// What a place's edit form sends, for both clients (Logjam Web's `PlaceDialog`,
// Logjam GPS's `PlaceEditSheet`): only what the user changed since the form
// opened. A sync can pull a newer value into the place while the form is open,
// and a field the user never touched must keep it rather than be overwritten by
// the text the form opened with (last write wins per field).
import { changedSince, setFieldValues } from "./fieldValues.js";
import { sameValue } from "./planItemEdit.js";
import type { SourceRow } from "./placeSources.js";
import {
  coerceFieldValue,
  type TripLogCustomFieldDef,
} from "./tripLogFields.js";

/** The form as typed: every word a string, the sources as rows. */
export type PlaceFormValues = {
  name: string;
  /** Comma separated, as typed. */
  altNames: string;
  latitude: string;
  longitude: string;
  notes: string;
  placeTypeId: string;
  fieldValues: Record<string, string>;
  sources: SourceRow[];
};

/** The fields of a place update the form can change. */
export type PlaceEditChanges = {
  name?: string;
  altNames?: string[];
  latitude?: number;
  longitude?: number;
  notes?: string | null;
  placeTypeId?: string;
  fieldValues?: Record<string, unknown>;
};

/**
 * The attribute values the user changed since the form opened, as stored:
 * an emptied one is null, which removes the key. Only the definitions the form
 * showed are asked.
 */
export function touchedFieldValues(
  seeded: Record<string, string>,
  current: Record<string, string>,
  defs: readonly TripLogCustomFieldDef[],
): Record<string, unknown> {
  const touched = changedSince(seeded, current);
  return Object.fromEntries(
    defs
      .filter((def) => def.key in touched)
      .map((def) => [
        def.key,
        touched[def.key].trim() === ""
          ? null
          : coerceFieldValue(touched[def.key], def.type),
      ]),
  );
}

/**
 * The update an edit sends. `fieldValues` is replaced wholesale by the server,
 * so a change is built OVER the place's values as they are now: another
 * client's key, and, on a type change, the old type's values (which the server
 * parks in `foreignFields`) stay in the payload.
 */
export function placeEditChanges(args: {
  /** The form as it opened, and as it is now. */
  seeded: PlaceFormValues;
  form: PlaceFormValues;
  /** The form read: a coordinate is null while it is not a number. */
  parsed: {
    name: string;
    altNames: string[];
    latitude: number | null;
    longitude: number | null;
    notes: string | null;
  };
  /** Whether the user typed in each coordinate since the form opened. */
  touched: { latitude: boolean; longitude: boolean };
  /** The place as it is now. */
  current: { latitude: number; longitude: number; fieldValues: unknown };
  typeFieldDefs: readonly TripLogCustomFieldDef[];
  /** What `sourcesPatch` made of the form's sources. */
  sourcesPatch: Record<string, unknown>;
}): PlaceEditChanges {
  const { seeded, form, parsed, touched, current } = args;
  const changes: PlaceEditChanges = {};
  if (form.name !== seeded.name) changes.name = parsed.name;
  if (form.altNames !== seeded.altNames) changes.altNames = parsed.altNames;
  if (
    touched.latitude &&
    parsed.latitude != null &&
    parsed.latitude !== current.latitude
  )
    changes.latitude = parsed.latitude;
  if (
    touched.longitude &&
    parsed.longitude != null &&
    parsed.longitude !== current.longitude
  )
    changes.longitude = parsed.longitude;
  if (form.notes !== seeded.notes) changes.notes = parsed.notes;
  if (form.placeTypeId !== seeded.placeTypeId)
    changes.placeTypeId = form.placeTypeId;
  const nextValues = setFieldValues(current.fieldValues, {
    ...touchedFieldValues(
      seeded.fieldValues,
      form.fieldValues,
      args.typeFieldDefs,
    ),
    ...args.sourcesPatch,
  });
  if (!sameValue(nextValues, setFieldValues(current.fieldValues, {})))
    changes.fieldValues = nextValues;
  return changes;
}
