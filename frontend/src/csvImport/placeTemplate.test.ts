import { describe, it, expect } from "vitest";
import { SYSTEM_PLACE_TYPE_IDS, type TripLogCustomFieldDef } from "@logjam/shared";

import Papa from "papaparse";
import { detectPlaceColumns } from "./placeColumns";
import {
  placeImportTemplateCsv,
  placeImportTemplateFilename,
} from "./placeTemplate";

/** The template is a STRING; parse it the way a spreadsheet would. (The app's
 *  own `parseCsv` takes a File and is async — same papaparse underneath.) */
function parse(csv: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  return {
    headers: (result.meta.fields ?? []).map((h) => h.trim()),
    rows: result.data,
  };
}

const canyonDefs: TripLogCustomFieldDef[] = [
  { key: "v_grade", label: "V Grade", type: "integer", min: 1, max: 7 },
  { key: "quality", label: "Quality", type: "float", min: 1, max: 5 },
];
const campsiteDefs: TripLogCustomFieldDef[] = [
  { key: "capacity", label: "Capacity", type: "integer", min: 1 },
  { key: "is_cave", label: "Is cave", type: "boolean" },
];

describe("placeImportTemplateCsv", () => {
  // THE POINT OF GENERATING IT: the static template asked every importer for a
  // V grade, so someone importing campsites got a file with no column for
  // capacity and one for a grade a campsite does not have.
  it("asks for the chosen type's own fields and nothing else", () => {
    const csv = placeImportTemplateCsv(
      "Campsite",
      SYSTEM_PLACE_TYPE_IDS.campsite,
      campsiteDefs,
    );
    const { headers } = parse(csv);
    expect(headers).toEqual([
      "name",
      "latitude",
      "longitude",
      "altNames",
      "notes",
      "Capacity",
      "Is cave",
    ]);
    expect(headers).not.toContain("V Grade");
  });

  // A template whose own headers the importer cannot place is a trap: the user
  // fills it in, imports it, and every type-specific column reads "discard".
  it("produces headers the column matcher recognises", () => {
    const csv = placeImportTemplateCsv("Campsite", SYSTEM_PLACE_TYPE_IDS.campsite, campsiteDefs);
    const { headers } = parse(csv);
    const roles = detectPlaceColumns(headers, campsiteDefs);
    expect(roles["name"]).toBe("name");
    expect(roles["latitude"]).toBe("latitude");
    expect(roles["Capacity"]).toBe("attr:capacity");
  });

  it("keeps the canyon example values the static template shipped with", () => {
    const csv = placeImportTemplateCsv("Canyon", SYSTEM_PLACE_TYPE_IDS.canyon, canyonDefs);
    const { rows } = parse(csv);
    expect(rows[0]["V Grade"]).toBe("4");
    expect(rows[0]["Quality"]).toBe("4");
  });

  it("gives a numeric example inside the field's own bounds", () => {
    // An example row that the field it demonstrates would reject is worse than
    // an empty one.
    const csv = placeImportTemplateCsv("Cave", "user-type", [
      { key: "depth", label: "Depth", type: "integer", min: 10, max: 20 },
    ]);
    const { rows } = parse(csv);
    const depth = Number(rows[0]["Depth"]);
    expect(depth).toBeGreaterThanOrEqual(10);
    expect(depth).toBeLessThanOrEqual(20);
  });

  // A label is user-authored text and may hold a comma. Unquoted, it would
  // split one column into two and every value after it would land in the wrong
  // field — silently, because a CSV with the wrong number of columns still
  // parses.
  it("quotes a header or value containing a comma", () => {
    const csv = placeImportTemplateCsv("Cave", "user-type", [
      { key: "rigging", label: "Rigging, in order", type: "string" },
    ]);
    expect(csv).toContain('"Rigging, in order"');
    const { headers, rows } = parse(csv);
    expect(headers).toContain("Rigging, in order");
    expect(rows[0]["name"]).toBe("Example Cave");
  });
});

describe("placeImportTemplateFilename", () => {
  it("names the file after the type, so three of them are tellable apart", () => {
    expect(placeImportTemplateFilename("Campsite")).toBe("campsite-import-template.csv");
    expect(placeImportTemplateFilename("Sea cave")).toBe("sea-cave-import-template.csv");
  });
});
