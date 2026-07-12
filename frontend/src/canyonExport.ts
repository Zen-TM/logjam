import Papa from "papaparse";
import type { TCanyon } from "./canyonUtils";

export type TExportFormat = "gpx" | "kml" | "geojson" | "csv";

// The user-meaningful canyon fields we are willing to put in an exported file.
// EXPORT-2: an explicit whitelist — NEVER spread the raw canyon record, which
// carries internal identifiers (ownerId, importBatchId, importKey, forkedFromId,
// ropeWikiSnapshot, _count, …) that must not leak into files users hand to third
// parties. These are exactly the columns of the CSV import template, so a GeoJSON
// or CSV export round-trips back through import. `name`, `latitude`, `longitude`
// are handled separately (name is the feature title; coords are the geometry).
const EXPORT_PROPERTY_KEYS = [
  "altNames",
  "vGrade",
  "aGrade",
  "commitment",
  "quality",
  "numAbseils",
  "longestAbseil",
  "hours",
  "notes",
] as const;

// Build the whitelisted property object for a GeoJSON feature. Explicit
// assignment per key (no spread) so a future field added to TCanyon can't
// silently start leaking through the export.
function exportProperties(c: TCanyon): Record<string, unknown> {
  return {
    name: c.name,
    altNames: c.altNames,
    vGrade: c.vGrade,
    aGrade: c.aGrade,
    commitment: c.commitment,
    quality: c.quality,
    numAbseils: c.numAbseils,
    longestAbseil: c.longestAbseil,
    hours: c.hours,
    notes: c.notes,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function descriptionText(c: TCanyon): string {
  const parts: string[] = [];
  if (c.altNames.length > 0) parts.push(`Also known as: ${c.altNames.join(", ")}`);
  if (c.vGrade != null) parts.push(`V-grade: ${c.vGrade}`);
  if (c.aGrade != null) parts.push(`A-grade: ${c.aGrade}`);
  if (c.commitment != null) parts.push(`Commitment: ${c.commitment}`);
  if (c.numAbseils != null) parts.push(`Abseils: ${c.numAbseils}`);
  if (c.longestAbseil != null) parts.push(`Longest abseil: ${c.longestAbseil}m`);
  if (c.hours != null) parts.push(`Duration: ${c.hours}h`);
  if (c.quality != null) parts.push(`Quality: ${c.quality}`);
  if (c.notes) parts.push(`Notes: ${c.notes}`);
  return parts.join("\n");
}

function filenameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function buildFilename(canyons: TCanyon[], ext: string): string {
  if (canyons.length === 1) {
    return `logjam-${filenameSlug(canyons[0].name)}.${ext}`;
  }
  return `logjam-canyons-${dateStamp()}.${ext}`;
}

function canyonsToGpx(canyons: TCanyon[]): Blob {
  const wpts = canyons
    .map((c) => {
      const desc = descriptionText(c);
      return [
        `  <wpt lat="${c.latitude}" lon="${c.longitude}">`,
        `    <name>${escapeXml(c.name)}</name>`,
        desc ? `    <desc>${escapeXml(desc)}</desc>` : "",
        `    <time>${c.updatedAt}</time>`,
        `  </wpt>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="Logjam" xmlns="http://www.topografix.com/GPX/1/1">`,
    wpts,
    `</gpx>`,
  ].join("\n");

  return new Blob([xml], { type: "application/gpx+xml" });
}

function canyonsToKml(canyons: TCanyon[]): Blob {
  const placemarks = canyons
    .map((c) => {
      const desc = descriptionText(c);
      return [
        `  <Placemark>`,
        `    <name>${escapeXml(c.name)}</name>`,
        desc ? `    <description><![CDATA[${desc}]]></description>` : "",
        `    <Point><coordinates>${c.longitude},${c.latitude},0</coordinates></Point>`,
        `  </Placemark>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2">`,
    `<Document>`,
    placemarks,
    `</Document>`,
    `</kml>`,
  ].join("\n");

  return new Blob([xml], { type: "application/vnd.google-earth.kml+xml" });
}

function canyonsToGeoJson(canyons: TCanyon[]): Blob {
  const features = canyons.map((c) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [c.longitude, c.latitude] },
    // Whitelisted properties only — see exportProperties / EXPORT_PROPERTY_KEYS.
    properties: exportProperties(c),
  }));

  const collection = { type: "FeatureCollection", features };
  return new Blob([JSON.stringify(collection, null, 2)], {
    type: "application/geo+json",
  });
}

// CSV columns, in the exact order of the import template
// (frontend/public/templates/canyon-import-template.csv) so an export can be
// re-imported unchanged. altNames serialise semicolon-separated, matching the
// template's "Alt Name 1; Alt Name 2" convention and parseAltNames on import.
const CSV_COLUMNS = [
  "name",
  "latitude",
  "longitude",
  ...EXPORT_PROPERTY_KEYS,
] as const;

function csvCell(c: TCanyon, column: (typeof CSV_COLUMNS)[number]): string {
  switch (column) {
    case "name":
      return c.name;
    case "latitude":
      return String(c.latitude);
    case "longitude":
      return String(c.longitude);
    case "altNames":
      return c.altNames.join("; ");
    case "notes":
      return c.notes ?? "";
    default: {
      // The remaining columns are nullable numbers; empty string for null so the
      // cell round-trips to "no value" rather than the literal "null".
      const value = c[column];
      return value == null ? "" : String(value);
    }
  }
}

function canyonsToCsv(canyons: TCanyon[]): Blob {
  // Papa.unparse handles CSV escaping (quotes, commas, newlines in notes) — the
  // symmetric counterpart to parseCsv's Papa.parse on import.
  const rows = canyons.map((c) => {
    const row: Record<string, string> = {};
    for (const column of CSV_COLUMNS) row[column] = csvCell(c, column);
    return row;
  });
  const csv = Papa.unparse({ fields: [...CSV_COLUMNS], data: rows });
  return new Blob([csv], { type: "text/csv" });
}

export function buildCanyonExport(
  canyons: TCanyon[],
  format: TExportFormat,
): { blob: Blob; filename: string } {
  switch (format) {
    case "gpx":
      return { blob: canyonsToGpx(canyons), filename: buildFilename(canyons, "gpx") };
    case "kml":
      return { blob: canyonsToKml(canyons), filename: buildFilename(canyons, "kml") };
    case "geojson":
      return { blob: canyonsToGeoJson(canyons), filename: buildFilename(canyons, "geojson") };
    case "csv":
      return { blob: canyonsToCsv(canyons), filename: buildFilename(canyons, "csv") };
  }
}
