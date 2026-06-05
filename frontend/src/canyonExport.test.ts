import { describe, it, expect } from "vitest";
import { buildCanyonExport } from "./canyonExport";
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
    wetsuits: null,
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
});

describe("buildCanyonExport — GeoJSON", () => {
  it("emits a FeatureCollection with a Point geometry", async () => {
    const { blob } = buildCanyonExport([canyon()], "geojson");
    const parsed = JSON.parse(await text(blob));
    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features[0].geometry).toEqual({ type: "Point", coordinates: [150.3, -33.5] });
  });
});
