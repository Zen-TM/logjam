import { describe, expect, it } from "vitest";

import type { TPlace } from "./apiTypes.js";
import {
  buildPlaceExport,
  PLACE_EXPORT_FORMATS,
  PLACE_TYPE_HEADER,
} from "./placeExport.js";

const place = {
  id: "p1",
  name: 'Made "up", Canyon',
  latitude: -33.5,
  longitude: 150.3,
  altNames: [],
  notes: "=1+1",
  fieldValues: { hours: 4 },
  updatedAt: "2026-06-01T00:00:00.000Z",
} as unknown as TPlace;

// The builder both clients write files from. Red when a format loses its
// mime type or its filename extension, or when the CSV stops quoting a cell
// that holds a quote or a comma (the cell would split into two columns).
describe("buildPlaceExport", () => {
  it("names each format's file after the place and gives it its mime type", () => {
    const files = PLACE_EXPORT_FORMATS.map(({ value }) =>
      buildPlaceExport([place], value),
    );
    expect(files.map((file) => file.filename)).toEqual([
      "logjam-made-up-canyon.gpx",
      "logjam-made-up-canyon.kml",
      "logjam-made-up-canyon.geojson",
      "logjam-made-up-canyon.csv",
    ]);
    expect(files.map((file) => file.mimeType)).toEqual([
      "application/gpx+xml",
      "application/vnd.google-earth.kml+xml",
      "application/geo+json",
      "text/csv",
    ]);
  });

  it("quotes a CSV cell with a quote or comma and defuses a formula", () => {
    const { content } = buildPlaceExport([place], "csv");
    const [header, row] = content.split("\r\n");
    expect(header.startsWith("name,latitude,longitude,altNames,notes")).toBe(
      true,
    );
    expect(row.startsWith('"Made ""up"", Canyon",-33.5,150.3,,\'=1+1')).toBe(
      true,
    );
  });
});

// Mutation: write the grade as `Grade:` (a user field labelled "Grade" would
// then collide), stop skipping the three keys, or drop the partial case.
describe.each([["gpx"], ["kml"]] as const)("%s description", (format) => {
  it.each([
    [{ v_grade: 3, a_grade: 4, commitment: 3 }, "Canyon grade: v3a4III"],
    [{ a_grade: 2 }, "Canyon grade: a2"],
  ])("writes %j as one line, not three", async (fieldValues, line) => {
    const { content } = buildPlaceExport(
      [{ ...place, fieldValues } as unknown as TPlace],
      format,
    );
    expect(content).toContain(line);
    for (const key of ["v_grade", "a_grade", "commitment"])
      expect(content).not.toContain(`${key}:`);
  });
});

// Mutation: drop PLACE_TYPE_HEADER from CSV_COLUMNS, or from CSV_TEXT_COLUMNS
// (a type named `=Hut` would then reach a spreadsheet unguarded).
describe("buildPlaceExport, CSV place type", () => {
  const types = [
    { id: "t-camp", name: "Campsite" },
    { id: "t-formula", name: "=Hut" },
  ];
  const typed = (placeTypeId: string) =>
    ({
      ...place,
      name: "Gully",
      notes: "",
      fieldValues: {},
      placeTypeId,
    }) as TPlace;

  it("names each place's type after the sources column, guarded, empty when unknown", () => {
    const { content } = buildPlaceExport(
      [typed("t-camp"), typed("t-formula"), typed("gone")],
      "csv",
      [],
      types,
    );
    const lines = content.split("\r\n");
    expect(lines[0].split(",").slice(0, 7)).toEqual([
      "name",
      "latitude",
      "longitude",
      "altNames",
      "notes",
      "sources",
      PLACE_TYPE_HEADER,
    ]);
    expect(lines.slice(1).map((line) => line.split(",").pop())).toEqual([
      "Campsite",
      "'=Hut",
      "",
    ]);
  });
});
