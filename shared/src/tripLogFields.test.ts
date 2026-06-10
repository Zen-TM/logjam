import { describe, it, expect } from "vitest";
import {
  makeCustomFieldKey,
  coerceFieldValue,
  isTripLogCustomFieldDef,
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
