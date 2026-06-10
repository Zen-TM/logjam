import { describe, it, expect } from "vitest";
import { coerceFieldValue } from "@logjam/shared";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import { getFieldValue } from "./customFieldValues";

const DEFS: TripLogCustomFieldDef[] = [
  { key: "has_anchors", label: "Has anchors?", type: "boolean" },
  { key: "group_size", label: "Group Size", type: "integer" },
  { key: "notes_field", label: "Extra Notes", type: "string" },
  { key: "water_temp", label: "Water Temp", type: "float" },
  { key: "last_visited", label: "Last Visited", type: "date" },
];

describe("getFieldValue", () => {
  it("defaults an unset boolean field to \"false\"", () => {
    expect(getFieldValue({}, DEFS, "has_anchors")).toBe("false");
  });

  it("defaults unset non-boolean fields to \"\"", () => {
    expect(getFieldValue({}, DEFS, "group_size")).toBe("");
    expect(getFieldValue({}, DEFS, "notes_field")).toBe("");
    expect(getFieldValue({}, DEFS, "water_temp")).toBe("");
    expect(getFieldValue({}, DEFS, "last_visited")).toBe("");
  });

  it("returns an explicitly-set value as-is, including boolean true/false", () => {
    expect(getFieldValue({ has_anchors: "true" }, DEFS, "has_anchors")).toBe("true");
    expect(getFieldValue({ has_anchors: "false" }, DEFS, "has_anchors")).toBe("false");
    expect(getFieldValue({ group_size: "4" }, DEFS, "group_size")).toBe("4");
  });

  it("returns \"\" for a key not present in defs", () => {
    expect(getFieldValue({}, DEFS, "unknown_key")).toBe("");
  });

  it("round-trips an unset boolean field through coerceFieldValue to false, not null", () => {
    const value = getFieldValue({}, DEFS, "has_anchors");
    expect(coerceFieldValue(value, "boolean")).toBe(false);
  });

  it("round-trips an unset non-boolean field through coerceFieldValue to null", () => {
    const value = getFieldValue({}, DEFS, "group_size");
    expect(coerceFieldValue(value, "integer")).toBe(null);
  });
});
