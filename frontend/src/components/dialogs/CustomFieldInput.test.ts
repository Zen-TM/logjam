import { describe, it, expect } from "vitest";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import { customFieldValueError } from "./CustomFieldInput";

const intField: TripLogCustomFieldDef = { key: "reps", label: "Reps", type: "integer" };
const floatField: TripLogCustomFieldDef = { key: "temp", label: "Temp", type: "float" };
const boundedInt: TripLogCustomFieldDef = {
  key: "rating",
  label: "Rating",
  type: "integer",
  min: 1,
  max: 5,
};
const stringField: TripLogCustomFieldDef = { key: "note", label: "Note", type: "string" };

describe("customFieldValueError", () => {
  it("returns null for non-numeric field types", () => {
    expect(customFieldValueError(stringField, "anything")).toBeNull();
  });
  it("flags a decimal typed into an integer field (TRIP-1)", () => {
    expect(customFieldValueError(intField, "5.5")).toBe("Whole numbers only");
    expect(customFieldValueError(intField, "5")).toBeNull();
  });
  it("allows negatives on an unbounded numeric field (e.g. temperature)", () => {
    expect(customFieldValueError(floatField, "-3.2")).toBeNull();
    expect(customFieldValueError(intField, "-3")).toBeNull();
  });
  it("enforces declared bounds (TRIP-2)", () => {
    expect(customFieldValueError(boundedInt, "6")).toBe("Must be between 1 and 5");
    expect(customFieldValueError(boundedInt, "0")).toBe("Must be between 1 and 5");
    expect(customFieldValueError(boundedInt, "3")).toBeNull();
  });
  it("treats empty as valid (unset)", () => {
    expect(customFieldValueError(intField, "")).toBeNull();
    expect(customFieldValueError(boundedInt, "")).toBeNull();
  });
});
