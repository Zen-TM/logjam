import { describe, it, expect } from "vitest";
import { detectCanyonColumns } from "./canyonColumns";

describe("detectCanyonColumns", () => {
  it("maps every header of the app's own canyon import template 1:1 (IMPORT-4)", () => {
    // Must match frontend/public/templates/canyon-import-template.csv exactly.
    const templateHeaders = [
      "name",
      "latitude",
      "longitude",
      "altNames",
      "vGrade",
      "aGrade",
      "commitment",
      "quality",
      "numAbseils",
      "longestAbseil",
      "hours",
      "notes",
    ];
    const result = detectCanyonColumns(templateHeaders);
    expect(result).toEqual({
      name: "name",
      latitude: "latitude",
      longitude: "longitude",
      altNames: "altNames",
      vGrade: "vGrade",
      aGrade: "aGrade",
      commitment: "commitment",
      quality: "quality",
      numAbseils: "numAbseils",
      longestAbseil: "longestAbseil",
      hours: "hours",
      notes: "notes",
    });
    // No template column silently discarded.
    expect(Object.values(result)).not.toContain("discard");
  });

  it("still maps the spaced/human aliases", () => {
    const result = detectCanyonColumns(["Alt Names", "Num Abseils", "Longest Abseil", "V Grade"]);
    expect(result["Alt Names"]).toBe("altNames");
    expect(result["Num Abseils"]).toBe("numAbseils");
    expect(result["Longest Abseil"]).toBe("longestAbseil");
    expect(result["V Grade"]).toBe("vGrade");
  });

  it("defaults an unrecognised header to discard", () => {
    expect(detectCanyonColumns(["Mystery Column"])["Mystery Column"]).toBe("discard");
  });

  it("auto-maps an exported sources column", () => {
    expect(detectCanyonColumns(["sources"])["sources"]).toBe("sources");
  });

  it("auto-maps an `attr:<key>` header to the matching custom-field role, preserving the key", () => {
    const result = detectCanyonColumns(["attr:rockType", "attr:first_descent"]);
    expect(result["attr:rockType"]).toBe("attr:rockType");
    expect(result["attr:first_descent"]).toBe("attr:first_descent");
  });

  it("is strict about the `attr:` prefix — a plain 'attribute' column still discards", () => {
    const result = detectCanyonColumns(["attribute", "attributes", "attr:"]);
    expect(result["attribute"]).toBe("discard");
    expect(result["attributes"]).toBe("discard");
    // Empty key after the prefix is not a valid custom field.
    expect(result["attr:"]).toBe("discard");
  });
});
