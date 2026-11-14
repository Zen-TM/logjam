// A length field (`isLengthField`) is typed in the display units and stored in
// metres, and every form that draws one converts at the same two places: the
// text it opens with (`fieldInputText`, or `fieldValueStrings` on Logjam GPS)
// and the value it saves (`coerceFieldInput`, with the stored value so an
// unedited length keeps its metres, or `coerceCustomFields` with it). The
// behaviour is in `units.test.ts` ("a length field"); this reads each form's
// source for the call, since none of the forms has a render harness that
// reaches its save.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..", "..");
const read = (file: string) =>
  readFileSync(join(repo, file), "utf8").replace(/\s+/g, " ");

describe("every form of a length field converts it", () => {
  // Mutation: change any of these calls back to the unit-blind one
  // (`String(raw)`, `coerceFieldValue(...)`, or `coerceCustomFields` without
  // the stored values), or drop `length={isLengthField(def.key)}` from either
  // filter.
  it.each([
    [
      "frontend/src/components/dialogs/PlaceDialog.tsx",
      [
        "vals[def.key] = fieldInputText(def.key, raw);",
        "attributes[def.key] = coerceFieldInput( def.key, getFieldValue(def.key), def.type, fieldValue(place?.fieldValues, def.key), );",
      ],
    ],
    [
      "frontend/src/components/dialogs/TripLogDialog.tsx",
      [
        "vals[def.key] = fieldInputText(def.key, raw);",
        "customFields[def.key] = coerceFieldInput( def.key, getFieldValue(def.key), def.type, );",
        "customFields[def.key] = coerceFieldInput( def.key, raw, def.type, tripLog?.customFields[def.key], );",
      ],
    ],
    [
      "mobile/src/places/PlaceEditSheet.tsx",
      [
        "fieldValues: fieldValueStrings(userFieldValues(place?.fieldValues)),",
        "coerceCustomFields( fieldValues, typeFieldDefs, place?.fieldValues, );",
      ],
    ],
    [
      "mobile/src/logs/TripEditSheet.tsx",
      [
        "setFieldValues(fieldValueStrings(trip?.customFields));",
        "coerceCustomFields(fieldValues, visibleFieldDefs, trip?.customFields),",
      ],
    ],
    [
      "frontend/src/ui/AttributeFilter.tsx",
      [
        "length={isLengthField(def.key)}",
        "[nextOperator, length ? lengthFromInput(parsed) : parsed]",
        "formatThreshold(value, length)",
      ],
    ],
    [
      "mobile/src/ui/AttributeFilter.tsx",
      [
        "length={isLengthField(def.key)}",
        "[nextOperator, length ? lengthFromInput(parsed) : parsed]",
        "formatThreshold(value, length)",
      ],
    ],
  ])("%s", (file, calls) => {
    const source = read(file);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(source, call).toContain(call);
  });
});
