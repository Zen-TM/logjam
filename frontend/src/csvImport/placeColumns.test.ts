import { describe, it, expect } from "vitest";
import { detectPlaceColumns } from "./placeColumns";

describe("detectPlaceColumns", () => {
  it("maps every header of the app's own place import template 1:1 (IMPORT-4)", () => {
    // The CANYON template's headers, which `placeImportTemplateCsv` now
    // generates from the Canyon type's own definitions (its own test asserts
    // the round trip). Kept here as the export/import round-trip case: an
    // export written with these headers must re-import 1:1.
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
    const result = detectPlaceColumns(templateHeaders);
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
    const result = detectPlaceColumns(["Alt Names", "Num Abseils", "Longest Abseil", "V Grade"]);
    expect(result["Alt Names"]).toBe("altNames");
    expect(result["Num Abseils"]).toBe("numAbseils");
    expect(result["Longest Abseil"]).toBe("longestAbseil");
    expect(result["V Grade"]).toBe("vGrade");
  });

  it("defaults an unrecognised header to discard", () => {
    expect(detectPlaceColumns(["Mystery Column"])["Mystery Column"]).toBe("discard");
  });

  it("auto-maps an exported sources column", () => {
    expect(detectPlaceColumns(["sources"])["sources"]).toBe("sources");
  });

  it("auto-maps an `attr:<key>` header to the matching custom-field role, preserving the key", () => {
    const result = detectPlaceColumns(["attr:rockType", "attr:first_descent"]);
    expect(result["attr:rockType"]).toBe("attr:rockType");
    expect(result["attr:first_descent"]).toBe("attr:first_descent");
  });

  it("is strict about the `attr:` prefix — a plain 'attribute' column still discards", () => {
    const result = detectPlaceColumns(["attribute", "attributes", "attr:"]);
    expect(result["attribute"]).toBe("discard");
    expect(result["attributes"]).toBe("discard");
    // Empty key after the prefix is not a valid custom field.
    expect(result["attr:"]).toBe("discard");
  });
});
