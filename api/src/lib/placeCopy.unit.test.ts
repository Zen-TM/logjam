import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    place: { findUnique: vi.fn(), update: vi.fn() },
    placeType: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    customFieldDef: { findMany: vi.fn() },
  },
}));

// The definitions each type carries are rows; what is under test is the
// DECISION taken over them, so they are supplied directly.
const defsByType: Record<string, { key: string; label: string; type: string }[]> = {};
vi.mock("./placeTypes", () => ({
  defsForPlaceType: vi.fn((_ownerId: string, typeId: string) =>
    Promise.resolve(defsByType[typeId] ?? []),
  ),
  createPlaceType: vi.fn(),
  visiblePlaceTypeWhere: vi.fn(),
}));

import { strandValuesOnTypeChange } from "./placeCopy";

const CANYON = "type-canyon";
const CAMPSITE = "type-campsite";

beforeEach(() => {
  defsByType[CANYON] = [
    { key: "v_grade", label: "V grade", type: "integer" },
    { key: "hours", label: "Hours", type: "float" },
  ];
  defsByType[CAMPSITE] = [{ key: "capacity", label: "Capacity", type: "integer" }];
});

describe("strandValuesOnTypeChange", () => {
  it("parks what the new type has no definition for", async () => {
    const result = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CANYON,
      toTypeId: CAMPSITE,
      fieldValues: { v_grade: 4, hours: 9 },
      foreignFields: null,
    });
    expect(result.fieldValues).toEqual({});
    expect(result.foreignFields.map((item) => item.key)).toEqual(["v_grade", "hours"]);
    // Described by the OLD type's definition, so it can be rendered — and
    // matched back — without it.
    expect(result.foreignFields[0].label).toBe("V grade");
    expect(result.foreignFields[0].type).toBe("integer");
  });

  // THE ROUND TRIP. Retyping used to be a one-way door: the way out parked the
  // values and the way back left them parked, beside a form with an empty rail
  // for the very same key. Adopting them was refused (409, reserved key), so
  // there was no way back at all.
  it("brings a parked value home when the new type defines its key", async () => {
    const away = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CANYON,
      toTypeId: CAMPSITE,
      fieldValues: { v_grade: 4, hours: 9 },
      foreignFields: null,
    });
    const back = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CAMPSITE,
      toTypeId: CANYON,
      fieldValues: away.fieldValues,
      foreignFields: away.foreignFields,
    });
    expect(back.fieldValues).toEqual({ v_grade: 4, hours: 9 });
    expect(back.foreignFields).toEqual([]);
  });

  it("keeps parking what still does not fit, across the round trip", async () => {
    const back = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CAMPSITE,
      toTypeId: CANYON,
      fieldValues: {},
      foreignFields: [
        { key: "v_grade", label: "V grade", type: "integer", value: 4 },
        { key: "gate_code", label: "Gate code", type: "string", value: "1234" },
      ],
    });
    expect(back.fieldValues).toEqual({ v_grade: 4 });
    // Nothing defines `gate_code` on either side, so it waits — with its label
    // intact, which is what makes an unlimited number of round trips safe.
    expect(back.foreignFields).toHaveLength(1);
    expect(back.foreignFields[0]).toMatchObject({ key: "gate_code", label: "Gate code" });
  });

  it("refuses a value whose TYPE disagrees, rather than corrupting the field", async () => {
    const back = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CAMPSITE,
      toTypeId: CANYON,
      fieldValues: {},
      // Parked as a string; the canyon's `v_grade` is an integer. A key match
      // alone would drop "4" into a numeric field, where every bound check and
      // every filter then reads a string.
      foreignFields: [{ key: "v_grade", label: "V grade", type: "string", value: "4" }],
    });
    expect(back.fieldValues).toEqual({});
    expect(back.foreignFields).toHaveLength(1);
  });

  it("keeps ONE entry per key, newest value winning", async () => {
    const result = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CANYON,
      toTypeId: CAMPSITE,
      fieldValues: { v_grade: 5 },
      foreignFields: [{ key: "v_grade", label: "V grade", type: "integer", value: 4 }],
    });
    // Two rows for one key would offer "decide what to do with this" twice and
    // only one of them would be right. The LIVE value wins: it is what the user
    // last typed, and the park is where an older copy of it went to wait.
    expect(result.foreignFields).toHaveLength(1);
    expect(result.foreignFields[0].value).toBe(5);
  });

  it("strands nothing when the type did not change", async () => {
    const result = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CANYON,
      toTypeId: CANYON,
      // `mystery` has no definition on any type. An ordinary edit must leave it
      // exactly where it is: another client is entitled to have written it, and
      // parking it would be this function inventing a schema decision nobody
      // asked for.
      fieldValues: { v_grade: 4, mystery: "kept" },
      foreignFields: [{ key: "gate_code", label: "Gate code", type: "string", value: "x" }],
    });
    expect(result.fieldValues).toEqual({ v_grade: 4, mystery: "kept" });
    expect(result.foreignFields).toHaveLength(1);
  });

  // THE HEAL. A row stranded before the reconciliation ran both ways has no
  // migration behind it; this is what brings those values back, on the next
  // ordinary save of the place, with no retyping dance.
  it("brings a parked value home on a plain edit, when the type defines it", async () => {
    const result = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CANYON,
      toTypeId: CANYON,
      fieldValues: {},
      foreignFields: [
        { key: "v_grade", label: "V grade", type: "integer", value: 4 },
        { key: "gate_code", label: "Gate code", type: "string", value: "1234" },
      ],
    });
    expect(result.fieldValues).toEqual({ v_grade: 4 });
    expect(result.foreignFields.map((item) => item.key)).toEqual(["gate_code"]);
  });

  it("does not let a parked value overwrite a live one on a plain edit", async () => {
    const result = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CANYON,
      toTypeId: CANYON,
      fieldValues: { v_grade: 6 },
      foreignFields: [{ key: "v_grade", label: "V grade", type: "integer", value: 4 }],
    });
    expect(result.fieldValues).toEqual({ v_grade: 6 });
    expect(result.foreignFields).toEqual([]);
  });

  it("carries internal keys across untouched", async () => {
    const result = await strandValuesOnTypeChange({
      ownerId: "alice",
      fromTypeId: CANYON,
      toTypeId: CAMPSITE,
      fieldValues: { _sources: [{ url: "https://example.test" }], v_grade: 4 },
      foreignFields: null,
    });
    expect(result.fieldValues._sources).toEqual([{ url: "https://example.test" }]);
  });
});
