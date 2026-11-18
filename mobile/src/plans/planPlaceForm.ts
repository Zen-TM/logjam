// What a plan place's form checks and keeps, for the edit sheet and the new
// place sheet (`PlanPlaceFields.tsx` draws both).
import {
  ITEM_ATTR,
  newPlaceFromWords,
  newPlaceWords,
  SYSTEM_FIELD_DEFS,
  validatePlacePayload,
  type ItemWords,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { coerceCustomFields } from "../customFields/fieldValueCoercion";
import { addPlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const blank = (text: string) => text.trim() === "";

/** The sentence for what is wrong with a place's position, elevation or
 *  attributes, or null when it can be sent. */
export function placeFormProblem(
  values: ItemWords,
  defs: TripLogCustomFieldDef[],
): string | null {
  const attrs = Object.fromEntries(
    defs.map((def) => [def.key, values[ITEM_ATTR + def.key] ?? ""]),
  );
  return validatePlacePayload(
    {
      latitude: blank(values.latitude) ? undefined : Number(values.latitude),
      longitude: blank(values.longitude) ? undefined : Number(values.longitude),
      elevation: blank(values.elevation) ? null : Number(values.elevation),
      fieldValues: Object.fromEntries(
        Object.entries(coerceCustomFields(attrs, defs)).filter(
          ([, value]) => value != null,
        ),
      ),
    },
    { requireCoords: true, defs: [...SYSTEM_FIELD_DEFS, ...defs] },
  );
}

/** A new place's words after its type changed: a type has its own attributes,
 *  so the ones typed under the last one go and everything else stays. */
export function retypePlaceWords(was: ItemWords, typeId: string): ItemWords {
  return {
    ...newPlaceWords(typeId),
    name: was.name,
    notes: was.notes,
    altNames: was.altNames,
    latitude: was.latitude,
    longitude: was.longitude,
    elevation: was.elevation,
  };
}

/** Makes the form's place in the plan, in no account. Throws on a refusal or
 *  no connection. */
export async function addNewPlaceToPlan(
  planId: string,
  typeId: string,
  words: ItemWords,
): Promise<void> {
  await addPlanItem(planId, {
    kind: "place",
    new: newPlaceFromWords(typeId, words),
  });
  await afterPlanWrite(planId);
}
