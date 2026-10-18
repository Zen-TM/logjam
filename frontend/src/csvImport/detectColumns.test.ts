import { describe, it, expect } from "vitest";
import { prepareTripRows } from "./prepareRows";
import { detectFileKind } from "./detectFileKind";
import { detectColumns } from "./detectColumns";
import type { TripLogCustomFieldDef } from "@logjam/shared";

const customFields: TripLogCustomFieldDef[] = [
  { key: "water_level", label: "Water Level", type: "string" },
];

describe("detectColumns", () => {
  it("maps name/date/notes aliases regardless of case and separators", () => {
    const result = detectColumns(
      ["Place Name", "Trip_Date", "  COMMENTS "],
      [],
    );
    expect(result["Place Name"]).toBe("name");
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

  it("maps Logjam Web's own logbook template headers (name/date/type/notes)", () => {
    // frontend/public/templates/logbook-import-template.csv headers.
    const result = detectColumns(
      ["name", "date", "type", "notes", "Party"],
      [],
    );
    expect(result["name"]).toBe("name");
    expect(result["date"]).toBe("date");
    expect(result["type"]).toBe("type");
    expect(result["notes"]).toBe("notes");
    // "Party" has no field of its own (TripLog has no participants column), so
    // it is added to the notes.
    expect(result["Party"]).toBe("appendNotes");
  });

  // detectFileKind and detectColumns each keep a name and a date alias list.
  // Mutation that turns it red: adding an alias to one list only.
  it.each(["Name", "Place", "Place name", "Location", "Site", "Canyon"])(
    "agrees with detectFileKind on the name header %s",
    (name) => {
      for (const date of [
        "Date",
        "Trip Date",
        "Visited",
        "When",
        "Visit date",
      ]) {
        const roles = Object.values(detectColumns([name, date], []));
        expect(roles).toEqual(["name", "date"]);
        expect(detectFileKind([name, date])).toBe("triplog");
      }
    },
  );

  it("defaults unrecognised headers to discard", () => {
    const result = detectColumns(["Mystery"], customFields);
    expect(result["Mystery"]).toBe("discard");
  });
});

// Mutation that turns it red: dropping the append-column loop in joinNotes
// (prepareRows.ts) loses the Party text, or not trimming the notes cell leaves
// a blank first line.
describe("prepareTripRows notes", () => {
  it("adds append columns to the notes, trimmed, and skips empty ones", () => {
    const base = {
      headers: ["Name", "Date", "Notes", "Party"],
      tripAssignments: {
        Name: "name",
        Date: "date",
        Notes: "notes",
        Party: "appendNotes",
      } as const,
      tripNewCfForms: {},
      customFieldDefs: [],
      dateFormat: "YYYY-MM-DD" as const,
    };
    const rows = [
      { Name: "A", Date: "2021-01-01", Notes: " ", Party: "Sam" },
      { Name: "B", Date: "2021-01-02", Notes: "dry", Party: " " },
      { Name: "C", Date: "2021-01-03", Notes: "", Party: "" },
    ];
    const out = prepareTripRows({ ...base, rows });
    expect(out.rows.map((r) => r.notes)).toEqual(["Party: Sam", "dry", null]);
  });
});
