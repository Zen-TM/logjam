import { describe, expect, it } from "vitest";

import type { TPlace } from "./apiTypes.js";
import { buildPlaceExport, PLACE_EXPORT_FORMATS } from "./placeExport.js";

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
