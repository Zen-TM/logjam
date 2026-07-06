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

  it("defaults unrecognised headers to discard", () => {
    const result = detectColumns(["Mystery"], customFields);
    expect(result["Mystery"]).toBe("discard");
  });
});
