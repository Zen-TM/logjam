// Parse track files (GPX/KML/GeoJSON) into GeoJSON for the map track layers.
// Parsing happens client-side (the API never echoes track contents — privacy
// rule), so we fetch the presigned S3 URL directly with raw fetch (not
// apiFetch, whose base URL + auth are for our own API, not S3).
//
// One parser for both track sources: a canyon's attached track and a standalone
// file (the user's own import or a recorded GPS track) differ only in which id
// gets stamped on the features, so the caller passes that stamp rather than
// this file knowing about canyons.

import { gpx, kml } from "@tmcw/togeojson";

/** Extra feature properties the caller needs back out of the map layer —
 * `{ canyonId }` for a canyon's track, `{ mediaId }` for a standalone file. */
export type TrackFeatureStamp = Record<string, string>;

const GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function featuresOfGeoJson(parsed: unknown): GeoJSON.Feature[] {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Track file is not valid GeoJSON");
  }
  const value = parsed as { type?: unknown; features?: unknown };
  if (value.type === "FeatureCollection") {
    if (!Array.isArray(value.features)) {
      throw new Error("Track file is not valid GeoJSON");
    }
    return value.features as GeoJSON.Feature[];
  }
  if (value.type === "Feature") return [parsed as GeoJSON.Feature];
  // A bare geometry (some exporters emit one) is wrapped so it draws like the
  // rest. Anything else is not GeoJSON we can render — say so rather than
  // returning an empty collection that looks like a track with no lines.
  if (typeof value.type === "string" && GEOMETRY_TYPES.has(value.type)) {
    return [
      { type: "Feature", geometry: parsed as GeoJSON.Geometry, properties: {} },
    ];
  }
  throw new Error("Track file is not valid GeoJSON");
}

// Stamp the track's assigned colour + the caller's ids onto every feature so
// the map line layer can colour data-driven via ["get", "color"].
export function parseTrackGeoJSON(
  text: string,
  color: string | null,
  stamp: TrackFeatureStamp,
): GeoJSON.FeatureCollection {
  let parsed: GeoJSON.FeatureCollection<GeoJSON.Geometry | null>;
  // GeoJSON is JSON, GPX/KML are XML — the first non-whitespace character is
  // the whole discriminator, and the MIME type isn't in hand at parse time.
  if (text.trimStart().startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Track file is not valid GeoJSON");
    }
    parsed = {
      type: "FeatureCollection",
      features: featuresOfGeoJson(json) as GeoJSON.Feature<GeoJSON.Geometry | null>[],
    };
  } else {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("Track file is not valid XML");
    }
    const root = doc.documentElement?.localName?.toLowerCase();
    if (root === "gpx") parsed = gpx(doc);
    else if (root === "kml") parsed = kml(doc);
    else throw new Error("Unrecognised track format (expected GPX, KML or GeoJSON)");
  }

  // Drop features without geometry (e.g. metadata-only waypoints), then stamp
  // colour + ids so the map line layer can colour via ["get", "color"].
  const features = parsed.features.filter(
    (feature): feature is GeoJSON.Feature<GeoJSON.Geometry> => feature.geometry != null,
  );
  for (const feature of features) {
    feature.properties = { ...(feature.properties ?? {}), color, ...stamp };
  }
  return { type: "FeatureCollection", features };
}

export async function fetchTrackGeoJSON(
  displayUrl: string,
  color: string | null,
  stamp: TrackFeatureStamp,
): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(displayUrl);
  if (!res.ok) throw new Error(`Couldn't fetch track (${res.status})`);
  return parseTrackGeoJSON(await res.text(), color, stamp);
}
