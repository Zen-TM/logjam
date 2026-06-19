import { describe, it, expect } from "vitest";
import {
  makeCustomFieldKey,
  coerceFieldValue,
  isTripLogCustomFieldDef,
  buildCustomFieldDef,
} from "./tripLogFields.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

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
