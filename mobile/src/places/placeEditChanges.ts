import {
  changedSince,
  setFieldValues as withFieldValues,
  type SourceRow,
} from "@logjam/shared";

import {
  coerceCustomFields,
  sameFieldValues,
} from "../customFields/fieldValueCoercion";
import type { MirrorPlace } from "../sync/mirrorStore";

export type PlaceFormValues = {
  name: string;
  altNames: string;
  latitude: string;
  longitude: string;
  notes: string;
  placeTypeId: string;
  fieldValues: Record<string, string>;
  sources: SourceRow[];
};

/**
 * What an edit pushes: only what the user changed since the sheet opened, so a
 * sync pull that landed while it was open is never overwritten by the text the
 * sheet opened with, and a concurrent edit to another field on another device
 * isn't clobbered either (last write wins per field).
 *
 * `fieldValues` is replaced wholesale by the server, so the change is built
 * OVER the place's values as they are now: another client's key, and, on a type
 * change, the old type's values (which the server parks in `foreignFields`)
 * stay in the payload.
 */
export function placeEditChanges(args: {
  /** The form as the sheet opened. */
  seeded: PlaceFormValues;
  /** The form now. */
  form: PlaceFormValues;
  /** `form` parsed: a coordinate is null while it is not a number. */
  parsed: {
    name: string;
    altNames: string[];
    latitude: number | null;
    longitude: number | null;
    notes: string | null;
  };
  /** The place as it is now. */
  current: MirrorPlace;
  typeFieldDefs: Parameters<typeof coerceCustomFields>[1];
  /** What `sourcesPatch` made of the form's sources. */
  sourcesPatch: Record<string, unknown>;
}): Record<string, unknown> {
  const { seeded, form, parsed, current } = args;
  const changes: Record<string, unknown> = {};
  if (form.name !== seeded.name) changes.name = parsed.name;
  if (form.altNames !== seeded.altNames) changes.altNames = parsed.altNames;
  if (form.latitude !== seeded.latitude && parsed.latitude != null)
    changes.latitude = parsed.latitude;
  if (form.longitude !== seeded.longitude && parsed.longitude != null)
    changes.longitude = parsed.longitude;
  if (form.notes !== seeded.notes) changes.notes = parsed.notes;
  if (form.placeTypeId !== seeded.placeTypeId)
    changes.placeTypeId = form.placeTypeId;
  const touched = changedSince(seeded.fieldValues, form.fieldValues);
  const nextValues = withFieldValues(current.fieldValues, {
    ...coerceCustomFields(
      touched,
      args.typeFieldDefs.filter((def) => def.key in touched),
    ),
    ...args.sourcesPatch,
  });
  if (!sameFieldValues(nextValues, current.fieldValues ?? {}))
    changes.fieldValues = nextValues;
  return changes;
}
