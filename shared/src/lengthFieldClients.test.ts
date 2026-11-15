// A length field (`isLengthField`) is typed in the display units and stored in
// metres. Every form that draws one converts at the same two places: the text
// it opens with (`fieldInputText`, or `fieldValueStrings` on Logjam GPS) and
// the value it saves (`coerceFieldInput`, with the stored value so an unedited
// length keeps its metres, or `coerceCustomFields` with it). Every page that
// reads one builds its rows with `attributeRows` or `tripPlanSetAsideRows`, or
// calls `withFieldUnit` itself. The conversions are held by `units.test.ts` ("a
// length field"); this file reads each form's and page's source for the call,
// since none of the forms has a render harness that reaches its save, and
// `attributeFilter.test.tsx` renders the web filter.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tripPlanSetAsideRows } from "./contracts/plans.js";
import { attributeRows } from "./logbook.js";
import { SYSTEM_FIELD_DEFS } from "./placeTypes.js";
import { setDisplayUnits } from "./units.js";

const repo = join(import.meta.dirname, "..", "..");
const read = (file: string) =>
  readFileSync(join(repo, file), "utf8").replace(/\s+/g, " ");

describe("every form of a length field converts it", () => {
  // Mutation: change any of these calls back to the unit-blind one
  // (`String(raw)`, `coerceFieldValue(...)`, or `coerceCustomFields` without
  // the stored values), drop `fieldKey={def.key}` from either filter, drop the
  // units from any one input's seed key (`displayUnits()` in the trip
  // sheet's `openKey`, `seedKey`, `seededUnits`, the plan item sheet's `key` or the plan item
  // dialog's `key`), drop the `seededUnits` check from a pick's return that
  // keeps the form, let a flip run all of `populateForm` (drop `unitsOnly`),
  // drop the filters' `shownUnits` reseed, or give a filter's
  // `coerceFieldInput` the `value` it is fed back instead of its `seed`.
  it.each([
    [
      "frontend/src/components/dialogs/PlaceDialog.tsx",
      [
        "vals[def.key] = fieldInputText(def.key, raw);",
        "attributes[def.key] = coerceFieldInput( def.key, getFieldValue(def.key), def.type, fieldValue(place?.fieldValues, def.key), );",
        "const units = displayUnits();",
        "setSeededUnits(displayUnits());",
        "} else if (open && seededUnits !== units) { populateForm({ unitsOnly: true }); }",
        "if (unitsOnly) return;",
      ],
    ],
    [
      "frontend/src/components/dialogs/TripLogDialog.tsx",
      [
        "vals[def.key] = fieldInputText(def.key, raw);",
        "customFields[def.key] = coerceFieldInput( def.key, getFieldValue(def.key), def.type, );",
        "customFields[def.key] = coerceFieldInput( def.key, raw, def.type, tripLog?.customFields[def.key], );",
        "if (seededUnits === displayUnits()) setFocusDateWhenOpened(false);",
        "} else if (open && seededUnits !== displayUnits()) { populateForm({ unitsOnly: true }); }",
        "if (unitsOnly) return;",
        "setSeededUnits(displayUnits());",
      ],
    ],
    [
      "mobile/src/places/PlaceEditSheet.tsx",
      [
        "fieldValues: fieldValueStrings(userFieldValues(place?.fieldValues)),",
        "coerceCustomFields( fieldValues, typeFieldDefs, place?.fieldValues, );",
        "units: displayUnits(),",
        "seededFor.units !== seedKey.units",
        "if (visible && (!resuming || seededUnits !== seedKey.units)) seed();",
        "setSeededUnits(displayUnits());",
      ],
    ],
    [
      "mobile/src/logs/TripEditSheet.tsx",
      [
        "setFieldValues(fieldValueStrings(trip?.customFields));",
        "coerceCustomFields(fieldValues, visibleFieldDefs, trip?.customFields),",
        'const openKey = visible ? `${trip?.id ?? "new"}|${displayUnits()}` : null;',
      ],
    ],
    [
      "mobile/src/plans/PlanItemSheet.tsx",
      [
        "const key = item ? `${item.kind}:${item.id}|${displayUnits()}` : null;",
      ],
    ],
    [
      "frontend/src/components/plans/PlanItems.tsx",
      ["key={displayUnits()} planId={plan.id}"],
    ],
    [
      "frontend/src/ui/AttributeFilter.tsx",
      [
        "fieldKey={def.key}",
        "label={withLengthUnit(def.key, def.label)}",
        'coerceFieldInput( fieldKey, nextText.trim(), "float", seed && seed.text === nextText.trim() ? seed.metres : undefined, ) as number',
        "if (units !== shownUnits) { setShownUnits(units); if (length && value) { setSeed(seeded(value)); setText(fieldInputText(fieldKey, value[1])); } }",
        "formatThreshold(value, length)",
      ],
    ],
    [
      "mobile/src/ui/AttributeFilter.tsx",
      [
        "fieldKey={def.key}",
        "label={withLengthUnit(def.key, def.label)}",
        'coerceFieldInput( fieldKey, nextText.trim(), "float", seed && seed.text === nextText.trim() ? seed.metres : undefined, ) as number',
        "if (units !== shownUnits) { setShownUnits(units); if (length && value) { setSeed(seeded(value)); setText(fieldInputText(fieldKey, value[1])); } }",
        "formatThreshold(value, length)",
      ],
    ],
  ])("%s", (file, calls) => {
    const source = read(file);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(source, call).toContain(call);
  });
});

describe("every page that reads a length goes through the units module", () => {
  const rows = () => [
    ...attributeRows(SYSTEM_FIELD_DEFS, { longest_abseil: 15, num_abseils: 6 }),
    // A value whose definition is gone lists under its key, and is a length too.
    ...attributeRows([], { longest_abseil: 15 }),
    ...tripPlanSetAsideRows({
      foreignFields: [
        {
          key: "longest_abseil",
          label: "Longest pitch",
          value: 15,
          type: "float",
        },
      ],
    } as Parameters<typeof tripPlanSetAsideRows>[0]),
  ];
  const lengths = () =>
    rows()
      .filter(([key]) => key === "longest_abseil")
      .map(([, , value]) => value);

  // Mutation: drop `.map(withRowUnit)` from `attributeRows`, or `withRowUnit`
  // from `tripPlanSetAsideRows`: the bare 15 comes back.
  it("every table of attribute rows reads a length in the display units", () => {
    try {
      expect(lengths()).toEqual(["15 m", "15 m", "15 m"]);
      setDisplayUnits("imperial");
      expect(lengths()).toEqual(["49.2 ft", "49.2 ft", "49.2 ft"]);
      // A count is a count.
      expect(rows().find(([key]) => key === "num_abseils")?.[2]).toBe(6);
    } finally {
      setDisplayUnits("metric");
    }
  });

  // Mutation: build the rows by hand in any of these (a bare
  // `[key, label, value, type]`), or print a parked value without
  // `withFieldUnit`.
  it.each([
    [
      "frontend/src/components/plans/PlanPlacePage.tsx",
      ["attributeRows(", "tripPlanSetAsideRows(place)"],
    ],
    [
      "mobile/src/plans/PlanPlaceSheet.tsx",
      ["attributeRows(", "tripPlanSetAsideRows(place)"],
    ],
    [
      "frontend/src/components/plans/PlanItemEditDialog.tsx",
      ["tripPlanSetAsideRows(place)"],
    ],
    [
      "frontend/src/components/sidebar/panels/TripDetailPanel.tsx",
      ["attributeRows(customFieldDefs, trip.customFields)"],
    ],
    [
      "mobile/src/logs/TripDetailScreen.tsx",
      ["attributeRows(fieldDefs, current.customFields)"],
    ],
    [
      "mobile/src/places/PlaceDetailScreen.tsx",
      [
        "attributeRows(labellingDefs, storedFields)",
        "withFieldUnit(key, String(value))",
      ],
    ],
    [
      "frontend/src/components/sidebar/panels/PlaceDetailPanel.tsx",
      ["withFieldUnit(def.key, text)", "withFieldUnit(item.key, text)"],
    ],
    [
      "frontend/src/components/dialogs/TripLogDialog.tsx",
      ["withFieldUnit(def.key, text)"],
    ],
  ])("%s", (file, calls) => {
    const source = read(file);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(source, call).toContain(call);
  });
});
