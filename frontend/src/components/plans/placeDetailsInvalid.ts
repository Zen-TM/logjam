import {
  ITEM_ATTR,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  type ItemWords,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import { customFieldValueError } from "../dialogs/CustomFieldInput";
import { numericFieldError } from "../../numberInput";

const LATITUDE = { min: LATITUDE_RANGE.min, max: LATITUDE_RANGE.max };
const LONGITUDE = { min: LONGITUDE_RANGE.min, max: LONGITUDE_RANGE.max };

/** Whether a place's position, elevation or attributes can't be sent yet. */
export function placeDetailsInvalid(
  values: ItemWords,
  defs: TripLogCustomFieldDef[],
): boolean {
  return (
    values.latitude.trim() === "" ||
    values.longitude.trim() === "" ||
    numericFieldError(values.latitude, LATITUDE) != null ||
    numericFieldError(values.longitude, LONGITUDE) != null ||
    numericFieldError(values.elevation, {}) != null ||
    defs.some(
      (def) => customFieldValueError(def, values[ITEM_ATTR + def.key]) != null,
    )
  );
}
