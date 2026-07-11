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
});
