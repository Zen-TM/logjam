// Vector file import parsers (mobile Stage 5): GPX / KML / GeoJSON → GeoJSON
// features for a MapLibre ShapeSource. Pure text-in → features-out; all file
// and picker I/O (and KMZ unzipping) lives in the caller.
//
// PRIVACY: imported files are the user's own track/waypoint data — parse
// errors are STATIC strings and must never echo file content or coordinate
// values.
import { XMLParser } from "fast-xml-parser";

export type ImportedPosition = number[]; // [lon, lat] or [lon, lat, ele]

export type ImportedGeometry =
  | { type: "Point"; coordinates: ImportedPosition }
  | { type: "MultiPoint"; coordinates: ImportedPosition[] }
  | { type: "LineString"; coordinates: ImportedPosition[] }
  | { type: "MultiLineString"; coordinates: ImportedPosition[][] }
  | { type: "Polygon"; coordinates: ImportedPosition[][] }
  | { type: "MultiPolygon"; coordinates: ImportedPosition[][][] };

export type ImportedFeature = {
  type: "Feature";
  geometry: ImportedGeometry;
  properties: { name?: string };
};

export type VectorImportResult = {
  /** Document/track-level name when the file carries one. */
  name: string | null;
  features: ImportedFeature[];
  /** [west, south, east, north] over every position in the file. */
  bbox: [number, number, number, number];
  stats: { points: number; lines: number; polygons: number; positions: number };
};

// Guardrail against pathological files locking up a phone. A dense all-day
// GPS track is ~10-100k points; half a million positions is nowhere near a
// legitimate personal-track import.
export const MAX_IMPORT_POSITIONS = 500_000;

export const IMPORT_ERRORS = {
  unparseable: "File could not be parsed",
  invalidCoordinates: "File contains invalid coordinates",
  noFeatures: "No mappable features found in the file",
  tooManyPositions: "File has too many points to import",
  unsupportedExtension: "Unsupported file type — use GPX, KML, or GeoJSON",
} as const;

// ── shared helpers ──────────────────────────────────────────────────────────

function assertValidPosition(position: ImportedPosition): void {
  const [lon, lat] = position;
  if (
    typeof lon !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < -180 ||
    lon > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    throw new Error(IMPORT_ERRORS.invalidCoordinates);
  }
}

function* positionsOf(geometry: ImportedGeometry): Generator<ImportedPosition> {
  switch (geometry.type) {
    case "Point":
      yield geometry.coordinates;
      break;
    case "MultiPoint":
    case "LineString":
      yield* geometry.coordinates;
      break;
    case "MultiLineString":
    case "Polygon":
      for (const ring of geometry.coordinates) yield* ring;
      break;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates)
        for (const ring of polygon) yield* ring;
      break;
  }
}

function finalize(
  name: string | null,
  features: ImportedFeature[],
): VectorImportResult {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let positions = 0;
  let points = 0;
  let lines = 0;
  let polygons = 0;
  for (const feature of features) {
    const t = feature.geometry.type;
    if (t === "Point" || t === "MultiPoint") points++;
    else if (t === "LineString" || t === "MultiLineString") lines++;
    else polygons++;
    for (const position of positionsOf(feature.geometry)) {
      assertValidPosition(position);
      positions++;
      if (positions > MAX_IMPORT_POSITIONS) {
        throw new Error(IMPORT_ERRORS.tooManyPositions);
      }
      const [lon, lat] = position;
      if (lon < west) west = lon;
      if (lat < south) south = lat;
      if (lon > east) east = lon;
      if (lat > north) north = lat;
    }
  }
  if (positions === 0) throw new Error(IMPORT_ERRORS.noFeatures);
  return {
    name,
    features,
    bbox: [west, south, east, north],
    stats: { points, lines, polygons, positions },
  };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function makeXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    // Keep every leaf as string — trkpt lat/lon parse to number explicitly.
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });
}

// ── GPX ─────────────────────────────────────────────────────────────────────

type GpxPoint = { "@_lat"?: string; "@_lon"?: string; ele?: string };

function gpxPosition(pt: GpxPoint): ImportedPosition {
  const lon = Number(pt["@_lon"]);
  const lat = Number(pt["@_lat"]);
  const ele = pt.ele != null ? Number(pt.ele) : null;
  const position =
    ele != null && Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat];
  assertValidPosition(position);
  return position;
}

/** Parse GPX 1.0/1.1: wpt → Point, trk/trkseg → LineString, rte → LineString. */
export function parseGpx(text: string): VectorImportResult {
  let root: Record<string, unknown>;
  try {
    root = makeXmlParser().parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(IMPORT_ERRORS.unparseable);
  }
  const gpx = root.gpx as Record<string, unknown> | undefined;
  if (gpx == null) throw new Error(IMPORT_ERRORS.unparseable);

  const features: ImportedFeature[] = [];

  for (const wpt of asArray(gpx.wpt as GpxPoint | GpxPoint[])) {
    const name = textOf((wpt as Record<string, unknown>).name);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: gpxPosition(wpt) },
      properties: name ? { name } : {},
    });
  }

  type GpxTrk = { name?: string; trkseg?: unknown };
  for (const trk of asArray(gpx.trk as GpxTrk | GpxTrk[])) {
    const name = textOf(trk.name);
    for (const seg of asArray(trk.trkseg as Record<string, unknown>[])) {
      const pts = asArray(seg?.trkpt as GpxPoint | GpxPoint[]).map(gpxPosition);
      if (pts.length === 0) continue;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: pts },
        properties: name ? { name } : {},
      });
    }
  }

  type GpxRte = { name?: string; rtept?: unknown };
  for (const rte of asArray(gpx.rte as GpxRte | GpxRte[])) {
    const name = textOf(rte.name);
    const pts = asArray(rte.rtept as GpxPoint | GpxPoint[]).map(gpxPosition);
    if (pts.length === 0) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: pts },
      properties: name ? { name } : {},
    });
  }

  const meta = gpx.metadata as Record<string, unknown> | undefined;
  const docName =
    textOf(meta?.name) ??
    // Single-track files: promote the track name to the document name.
    (features.length > 0 ? (features[0].properties.name ?? null) : null);
  return finalize(docName, features);
}

// ── KML ─────────────────────────────────────────────────────────────────────

/** "lon,lat[,alt] lon,lat[,alt] …" (whitespace-separated tuples). */
function kmlCoordinates(text: string): ImportedPosition[] {
  const positions: ImportedPosition[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    if (tuple === "") continue;
    const parts = tuple.split(",").map(Number);
    if (parts.length < 2) throw new Error(IMPORT_ERRORS.invalidCoordinates);
    const position =
      parts.length >= 3 && Number.isFinite(parts[2])
        ? [parts[0], parts[1], parts[2]]
        : [parts[0], parts[1]];
    assertValidPosition(position);
    positions.push(position);
  }
  return positions;
}

function kmlGeometries(node: Record<string, unknown>): ImportedGeometry[] {
  const geometries: ImportedGeometry[] = [];
  for (const point of asArray(node.Point as Record<string, unknown>[])) {
    const coords = kmlCoordinates(textOf(point?.coordinates) ?? "");
    if (coords.length > 0)
      geometries.push({ type: "Point", coordinates: coords[0] });
  }
  for (const line of asArray(node.LineString as Record<string, unknown>[])) {
    const coords = kmlCoordinates(textOf(line?.coordinates) ?? "");
    if (coords.length > 0)
      geometries.push({ type: "LineString", coordinates: coords });
  }
  for (const polygon of asArray(node.Polygon as Record<string, unknown>[])) {
    const rings: ImportedPosition[][] = [];
    const outer = (
      (polygon?.outerBoundaryIs as Record<string, unknown>)?.LinearRing as
        | Record<string, unknown>
        | undefined
    )?.coordinates;
    const outerCoords = kmlCoordinates(textOf(outer) ?? "");
    if (outerCoords.length > 0) rings.push(outerCoords);
    for (const inner of asArray(
      polygon?.innerBoundaryIs as Record<string, unknown>[],
    )) {
      const ring = kmlCoordinates(
        textOf((inner?.LinearRing as Record<string, unknown>)?.coordinates) ??
          "",
      );
      if (ring.length > 0) rings.push(ring);
    }
    if (rings.length > 0) geometries.push({ type: "Polygon", coordinates: rings });
  }
  for (const multi of asArray(node.MultiGeometry as Record<string, unknown>[])) {
    geometries.push(...kmlGeometries(multi));
  }
  return geometries;
}

function collectPlacemarks(
  node: Record<string, unknown>,
  features: ImportedFeature[],
): void {
  for (const placemark of asArray(node.Placemark as Record<string, unknown>[])) {
    const name = textOf(placemark.name);
    for (const geometry of kmlGeometries(placemark)) {
      features.push({
        type: "Feature",
        geometry,
        properties: name ? { name } : {},
      });
    }
  }
  // Placemarks nest under Document and arbitrarily deep Folder trees.
  for (const child of [
    ...asArray(node.Document as Record<string, unknown>[]),
    ...asArray(node.Folder as Record<string, unknown>[]),
  ]) {
    collectPlacemarks(child, features);
  }
}

/** Parse KML 2.2: Placemark Point/LineString/Polygon/MultiGeometry. */
export function parseKml(text: string): VectorImportResult {
  let root: Record<string, unknown>;
  try {
    root = makeXmlParser().parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(IMPORT_ERRORS.unparseable);
  }
  const kml = root.kml as Record<string, unknown> | undefined;
  if (kml == null) throw new Error(IMPORT_ERRORS.unparseable);
  const features: ImportedFeature[] = [];
  collectPlacemarks(kml, features);
  const doc = asArray(kml.Document as Record<string, unknown>[])[0];
  return finalize(textOf(doc?.name), features);
}

// ── GeoJSON ─────────────────────────────────────────────────────────────────

const GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);

function normalizeGeoJsonFeature(raw: unknown): ImportedFeature {
  const feature = raw as {
    type?: unknown;
    geometry?: { type?: unknown } | null;
    properties?: Record<string, unknown> | null;
  };
  if (
    feature?.type !== "Feature" ||
    feature.geometry == null ||
    !GEOMETRY_TYPES.has(feature.geometry.type as string)
  ) {
    throw new Error(IMPORT_ERRORS.unparseable);
  }
  const name = textOf(feature.properties?.name);
  return {
    type: "Feature",
    geometry: feature.geometry as ImportedGeometry,
    properties: name ? { name } : {},
  };
}

/** Parse GeoJSON: FeatureCollection, single Feature, or bare geometry. */
export function parseGeoJson(text: string): VectorImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(IMPORT_ERRORS.unparseable);
  }
  const value = raw as { type?: unknown; features?: unknown; name?: unknown };
  let features: ImportedFeature[];
  if (value?.type === "FeatureCollection") {
    if (!Array.isArray(value.features))
      throw new Error(IMPORT_ERRORS.unparseable);
    features = value.features.map(normalizeGeoJsonFeature);
  } else if (value?.type === "Feature") {
    features = [normalizeGeoJsonFeature(value)];
  } else if (GEOMETRY_TYPES.has(value?.type as string)) {
    features = [
      {
        type: "Feature",
        geometry: value as unknown as ImportedGeometry,
        properties: {},
      },
    ];
  } else {
    throw new Error(IMPORT_ERRORS.unparseable);
  }
  return finalize(textOf(value.name), features);
}

// ── dispatcher ──────────────────────────────────────────────────────────────

/** Route by file extension. KMZ must be unzipped to its doc.kml by the caller. */
export function parseVectorImport(
  fileName: string,
  text: string,
): VectorImportResult {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  switch (extension) {
    case "gpx":
      return parseGpx(text);
    case "kml":
      return parseKml(text);
    case "geojson":
    case "json":
      return parseGeoJson(text);
    default:
      throw new Error(IMPORT_ERRORS.unsupportedExtension);
  }
}
