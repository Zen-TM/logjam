import { describe, it, expect } from "vitest";
import type { CustomFieldDefRow } from "./tripLogFields.js";
import {
  customFieldDefFromRow,
  makeCustomFieldKey,
  coerceFieldValue,
  coerceFieldValueStrict,
  isTripLogCustomFieldDef,
  buildCustomFieldDef,
  tripLogHasCustomFieldValue,
  countTripLogsWithCustomField,
  renameCustomFieldLabel,
  tripFieldDefs,
  isSystemFieldDef,
} from "./tripLogFields.js";
import type {
  ScopedCustomFieldDef,
  TripLogCustomFieldDef,
} from "./tripLogFields.js";

describe("makeCustomFieldKey", () => {
  it("lowercases and replaces non-alphanumeric runs with underscores", () => {
    expect(makeCustomFieldKey("Rope Length (m)")).toBe("rope_length_m");
  });

  it("trims leading/trailing separators", () => {
    expect(makeCustomFieldKey("  Spaces  ")).toBe("spaces");
  });

  it("collapses a punctuation-only label to an empty key", () => {
    expect(makeCustomFieldKey("---")).toBe("");
  });

  it("strips unicode/punctuation-only input to empty", () => {
    expect(makeCustomFieldKey("★彡")).toBe("");
  });
});

describe("coerceFieldValue", () => {
  it("returns null for an empty string regardless of type", () => {
    expect(coerceFieldValue("", "string")).toBeNull();
    expect(coerceFieldValue("", "integer")).toBeNull();
    expect(coerceFieldValue("", "float")).toBeNull();
    expect(coerceFieldValue("", "boolean")).toBeNull();
    expect(coerceFieldValue("", "date")).toBeNull();
  });

  it("parses integer values, truncating decimals", () => {
    expect(coerceFieldValue("3.7", "integer")).toBe(3);
    expect(coerceFieldValue("42", "integer")).toBe(42);
  });

  it("returns NaN for a non-numeric integer value (existing behaviour, pinned)", () => {
    expect(coerceFieldValue("abc", "integer")).toBeNaN();
  });

  it("parses float values", () => {
    expect(coerceFieldValue("3.7", "float")).toBe(3.7);
  });

  it("returns NaN for a non-numeric float value (existing behaviour, pinned)", () => {
    expect(coerceFieldValue("abc", "float")).toBeNaN();
  });

  it("treats only the literal string 'true' as boolean true", () => {
    expect(coerceFieldValue("true", "boolean")).toBe(true);
    expect(coerceFieldValue("false", "boolean")).toBe(false);
    expect(coerceFieldValue("0", "boolean")).toBe(false);
    expect(coerceFieldValue("yes", "boolean")).toBe(false);
  });

  it("passes string and date values through unchanged", () => {
    expect(coerceFieldValue("hello", "string")).toBe("hello");
    expect(coerceFieldValue("2026-01-01", "date")).toBe("2026-01-01");
  });
});

describe("isTripLogCustomFieldDef", () => {
  it("accepts a valid definition", () => {
    expect(
      isTripLogCustomFieldDef({ key: "rope_length_m", label: "Rope Length (m)", type: "integer" }),
    ).toBe(true);
  });

  it("rejects a missing or empty key", () => {
    expect(isTripLogCustomFieldDef({ label: "Rope Length", type: "integer" })).toBe(false);
    expect(isTripLogCustomFieldDef({ key: "", label: "Rope Length", type: "integer" })).toBe(false);
  });

  it("rejects a missing or empty label", () => {
    expect(isTripLogCustomFieldDef({ key: "rope_length", type: "integer" })).toBe(false);
    expect(isTripLogCustomFieldDef({ key: "rope_length", label: "", type: "integer" })).toBe(false);
  });

  it("rejects an invalid type", () => {
    expect(
      isTripLogCustomFieldDef({ key: "rope_length", label: "Rope Length", type: "decimal" }),
    ).toBe(false);
  });

  it("rejects non-objects and null", () => {
    expect(isTripLogCustomFieldDef(null)).toBe(false);
    expect(isTripLogCustomFieldDef("a string")).toBe(false);
    expect(isTripLogCustomFieldDef(42)).toBe(false);
  });
});

describe("buildCustomFieldDef", () => {
  const existing: TripLogCustomFieldDef[] = [
    { key: "group_size", label: "Group Size", type: "integer" },
  ];

  it("builds a plain string field", () => {
    const result = buildCustomFieldDef(
      { label: "Notes", type: "string", bounded: false, min: "", max: "" },
      [],
    );
    expect(result).toEqual({ def: { key: "notes", label: "Notes", type: "string" } });
  });

  it("rejects empty label", () => {
    const result = buildCustomFieldDef(
      { label: "  ", type: "string", bounded: false, min: "", max: "" },
      [],
    );
    expect(result).toEqual({ error: "Label is required." });
  });

  it("rejects duplicate key", () => {
    const result = buildCustomFieldDef(
      { label: "Group Size", type: "integer", bounded: false, min: "", max: "" },
      existing,
    );
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("already exists");
  });

  it("builds bounded integer field", () => {
    const result = buildCustomFieldDef(
      { label: "Rating", type: "integer", bounded: true, min: "1", max: "5" },
      [],
    );
    expect(result).toEqual({
      def: { key: "rating", label: "Rating", type: "integer", min: 1, max: 5 },
    });
  });

  it("builds bounded float field", () => {
    const result = buildCustomFieldDef(
      { label: "Temperature", type: "float", bounded: true, min: "-10.5", max: "45.0" },
      [],
    );
    expect(result).toEqual({
      def: { key: "temperature", label: "Temperature", type: "float", min: -10.5, max: 45 },
    });
  });

  it("rejects missing min for bounded field", () => {
    const result = buildCustomFieldDef(
      { label: "Rating", type: "integer", bounded: true, min: "", max: "5" },
      [],
    );
    expect(result).toEqual({ error: "Both min and max are required for a bounded field." });
  });

  it("rejects missing max for bounded field", () => {
    const result = buildCustomFieldDef(
      { label: "Rating", type: "integer", bounded: true, min: "1", max: "" },
      [],
    );
    expect(result).toEqual({ error: "Both min and max are required for a bounded field." });
  });

  it("rejects non-finite bounds", () => {
    const result = buildCustomFieldDef(
      { label: "Rating", type: "integer", bounded: true, min: "abc", max: "5" },
      [],
    );
    expect(result).toEqual({ error: "Min and max must be valid numbers." });
  });

  it("rejects min >= max", () => {
    const result = buildCustomFieldDef(
      { label: "Rating", type: "integer", bounded: true, min: "5", max: "5" },
      [],
    );
    expect(result).toEqual({ error: "Minimum must be less than maximum." });
  });

  it("ignores bounded flag for non-numeric types", () => {
    const result = buildCustomFieldDef(
      { label: "When", type: "date", bounded: true, min: "1", max: "5" },
      [],
    );
    expect(result).toEqual({ def: { key: "when", label: "When", type: "date" } });
  });

  it("ignores bounded=false even for numeric types", () => {
    const result = buildCustomFieldDef(
      { label: "Count", type: "integer", bounded: false, min: "1", max: "5" },
      [],
    );
    expect(result).toEqual({ def: { key: "count", label: "Count", type: "integer" } });
  });
});

describe("coerceFieldValueStrict", () => {
  it("treats empty/whitespace as an unset null success", () => {
    expect(coerceFieldValueStrict("", "integer")).toEqual({ ok: true, value: null });
    expect(coerceFieldValueStrict("   ", "float")).toEqual({ ok: true, value: null });
  });

  it("parses valid integers and rejects decimals/garbage", () => {
    expect(coerceFieldValueStrict("42", "integer")).toEqual({ ok: true, value: 42 });
    expect(coerceFieldValueStrict("-7", "integer")).toEqual({ ok: true, value: -7 });
    expect(coerceFieldValueStrict("5.5", "integer")).toEqual({ ok: false });
    expect(coerceFieldValueStrict("abc", "integer")).toEqual({ ok: false });
  });

  it("parses valid floats and rejects non-finite input", () => {
    expect(coerceFieldValueStrict("5.5", "float")).toEqual({ ok: true, value: 5.5 });
    expect(coerceFieldValueStrict("banana", "float")).toEqual({ ok: false });
    expect(coerceFieldValueStrict("Infinity", "float")).toEqual({ ok: false });
  });

  it("coerces booleans and passes strings through", () => {
    expect(coerceFieldValueStrict("true", "boolean")).toEqual({ ok: true, value: true });
    expect(coerceFieldValueStrict("false", "boolean")).toEqual({ ok: true, value: false });
    expect(coerceFieldValueStrict("hello", "string")).toEqual({ ok: true, value: "hello" });
  });
});

describe("tripLogHasCustomFieldValue", () => {
  it("is true only when the key is present and non-empty", () => {
    expect(tripLogHasCustomFieldValue({ a: "x" }, "a")).toBe(true);
    expect(tripLogHasCustomFieldValue({ a: 0 }, "a")).toBe(true);
    expect(tripLogHasCustomFieldValue({ a: false }, "a")).toBe(true);
    expect(tripLogHasCustomFieldValue({ a: "" }, "a")).toBe(false);
    expect(tripLogHasCustomFieldValue({ a: null }, "a")).toBe(false);
    expect(tripLogHasCustomFieldValue({}, "a")).toBe(false);
    expect(tripLogHasCustomFieldValue(null, "a")).toBe(false);
  });
});

describe("countTripLogsWithCustomField", () => {
  it("counts only trips carrying a value for the key", () => {
    const trips = [
      { customFields: { rope: 30 } },
      { customFields: { rope: "" } },
      { customFields: { wetsuit: true } },
      { customFields: { rope: null } },
      { customFields: {} },
    ];
    expect(countTripLogsWithCustomField(trips, "rope")).toBe(1);
    expect(countTripLogsWithCustomField(trips, "wetsuit")).toBe(1);
    expect(countTripLogsWithCustomField([], "rope")).toBe(0);
  });
});

describe("renameCustomFieldLabel", () => {
  const defs: TripLogCustomFieldDef[] = [
    { key: "water_level", label: "Water Level", type: "string" },
    { key: "rope", label: "Rope Length", type: "integer" },
  ];

  it("renames the label but preserves the key (never orphans values)", () => {
    const result = renameCustomFieldLabel(defs, "water_level", "Water Depth");
    expect(result).toEqual({
      defs: [
        { key: "water_level", label: "Water Depth", type: "string" },
        { key: "rope", label: "Rope Length", type: "integer" },
      ],
    });
  });

  it("rejects an empty label", () => {
    expect(renameCustomFieldLabel(defs, "rope", "  ")).toEqual({ error: "Label is required." });
  });

  it("rejects an unknown key", () => {
    expect(renameCustomFieldLabel(defs, "nope", "X")).toEqual({
      error: "That field no longer exists.",
    });
  });

  it("is a no-op when the label is unchanged", () => {
    const result = renameCustomFieldLabel(defs, "rope", "Rope Length");
    expect(result).toEqual({ defs });
  });
});

// One-sided bounds, end to end through the row reader. Three of the system
// definitions are min-only (`hours`, `num_abseils`, `longest_abseil`) — there
// is no honest ceiling for "how many pitches" — and the both-or-neither rule
// this replaces dropped their bound silently on the way out of the database.
describe("customFieldDefFromRow with one-sided bounds", () => {
  const row = (over: Partial<CustomFieldDefRow>): CustomFieldDefRow => ({
    entity: "place",
    key: "num_abseils",
    label: "Pitches",
    type: "integer",
    min: null,
    max: null,
    position: 0,
    ...over,
  });

  it("keeps a min with no max", () => {
    expect(customFieldDefFromRow(row({ min: 0 }))).toEqual({
      key: "num_abseils",
      label: "Pitches",
      type: "integer",
      min: 0,
    });
  });

  it("keeps a max with no min", () => {
    expect(customFieldDefFromRow(row({ max: 10 }))).toMatchObject({ max: 10 });
  });

  it("keeps both when both are set", () => {
    expect(customFieldDefFromRow(row({ min: 1, max: 7 }))).toMatchObject({
      min: 1,
      max: 7,
    });
  });

  it("carries no bounds when neither is set", () => {
    const def = customFieldDefFromRow(row({}));
    expect(def).not.toHaveProperty("min");
    expect(def).not.toHaveProperty("max");
  });
});

// §7.5 — the union clause. Without it, four ordinary actions each silently
// destroy a value: unlink a place, delete one, change its type, rescope a
// definition.
describe("tripFieldDefs", () => {
  const scoped = (
    key: string,
    placeTypeIds: string[],
    appliesToAllTypes = false,
  ): ScopedCustomFieldDef => ({
    key,
    label: key,
    type: "string",
    placeTypeIds,
    appliesToAllTypes,
  });

  const water = scoped("water", ["canyon"]);
  const firewood = scoped("firewood", ["campsite"]);
  const weather = scoped("weather", [], true);
  const defs = [water, firewood, weather];

  it("asks the questions the linked places' types ask", () => {
    expect(tripFieldDefs(defs, ["canyon"], {}).map((def) => def.key)).toEqual([
      "water",
      "weather",
    ]);
  });

  it("unions the types of several linked places, showing a shared field once", () => {
    const both = scoped("party", ["canyon", "campsite"]);
    expect(
      tripFieldDefs([...defs, both], ["canyon", "campsite"], {}).map((d) => d.key),
    ).toEqual(["water", "firewood", "weather", "party"]);
  });

  // "Walked around the block" is the common case, not an edge case.
  it("asks only the always-on fields when a trip links no place", () => {
    expect(tripFieldDefs(defs, [], {}).map((def) => def.key)).toEqual(["weather"]);
  });

  // THE CLAUSE THAT STOPS IT EATING DATA. Unlinking a place, deleting one,
  // retyping it or rescoping a definition would each otherwise hide a value the
  // user typed — and the next save writes the object the form knows about, so
  // hidden means gone.
  it("keeps a field whose value is already recorded, whatever the scoping says", () => {
    expect(
      tripFieldDefs(defs, [], { water: "high" }).map((def) => def.key),
    ).toEqual(["water", "weather"]);
  });

  it("does not resurrect a field whose value was cleared", () => {
    expect(
      tripFieldDefs(defs, [], { water: null }).map((def) => def.key),
    ).toEqual(["weather"]);
  });
});

describe("isSystemFieldDef", () => {
  const scoped = (over: Partial<ScopedCustomFieldDef>): ScopedCustomFieldDef => ({
    key: "water_level",
    label: "Water level",
    type: "string",
    placeTypeIds: [],
    appliesToAllTypes: true,
    ...over,
  });

  it("is true for a built-in", () => {
    expect(isSystemFieldDef(scoped({ key: "v_grade", ownerId: null }))).toBe(true);
  });

  // THE REGRESSION. A definition created on the phone has no owner id until the
  // server sends one back, and `ownerId === null` alone called that a built-in:
  // the field the user had just added drew a padlock and no verbs until the
  // next delta landed.
  it("is false for a locally-created field that has no owner id yet", () => {
    expect(isSystemFieldDef(scoped({ ownerId: null }))).toBe(false);
  });

  it("is false for an owned field, reserved key or not", () => {
    expect(isSystemFieldDef(scoped({ ownerId: "alice" }))).toBe(false);
    expect(isSystemFieldDef(scoped({ key: "v_grade", ownerId: "alice" }))).toBe(false);
  });

  it("is false when the owner id is absent entirely — offer the verbs, let the server refuse", () => {
    expect(isSystemFieldDef(scoped({}))).toBe(false);
  });
});
