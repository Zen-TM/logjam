import { describe, it, expect } from "vitest";
import { detectColumns } from "./detectColumns";
import type { TripLogCustomFieldDef } from "@logjam/shared";

const customFields: TripLogCustomFieldDef[] = [
  { key: "water_level", label: "Water Level", type: "string" },
];

describe("detectColumns", () => {
  it("maps name/date/notes aliases regardless of case and separators", () => {
    const result = detectColumns(["Canyon Name", "Trip_Date", "  COMMENTS "], []);
    expect(result["Canyon Name"]).toBe("name");
    expect(result["Trip_Date"]).toBe("date");
    expect(result["  COMMENTS "]).toBe("notes");
  });

  it("maps type aliases", () => {
    const result = detectColumns(["Type", "ACTIVITY", "Trip_Type"], []);
    expect(result["Type"]).toBe("type");
    expect(result["ACTIVITY"]).toBe("type");
    expect(result["Trip_Type"]).toBe("type");
  });

  it("matches a custom field by its normalized label", () => {
    const result = detectColumns(["water level"], customFields);
    expect(result["water level"]).toBe("cf:water_level");
  });

  it("matches a custom field by its key", () => {
    const result = detectColumns(["water_level"], customFields);
    expect(result["water_level"]).toBe("cf:water_level");
  });

  it("maps the app's own logbook template headers (name/date/type/notes)", () => {
    // frontend/public/templates/logbook-import-template.csv headers.
    const result = detectColumns(["name", "date", "type", "notes", "Party"], []);
    expect(result["name"]).toBe("name");
    expect(result["date"]).toBe("date");
    expect(result["type"]).toBe("type");
    expect(result["notes"]).toBe("notes");
    // "Party" has no built-in trip field (TripLog has no participants column),
    // so it is left for the user to map or ignore. Documented in the fix report.
    expect(result["Party"]).toBe("discard");
  });

  it("defaults unrecognised headers to discard", () => {
    const result = detectColumns(["Mystery"], customFields);
    expect(result["Mystery"]).toBe("discard");
  });
});
