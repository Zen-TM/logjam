// Parse uploaded GPX/KML track files into GeoJSON for the map track layer.
// Parsing happens client-side (the API never echoes track contents — privacy
// rule), so we fetch the presigned S3 URL directly with raw fetch (not
// apiFetch, whose base URL + auth are for our own API, not S3).

import { gpx, kml } from "@tmcw/togeojson";

// Stamp the track's assigned colour + owning canyon onto every feature so the
// map line layer can colour data-driven via ["get", "color"].
export function parseTrackGeoJSON(
  xmlText: string,
  color: string | null,
  canyonId: string,
): GeoJSON.FeatureCollection {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Track file is not valid XML");
  }
  const root = doc.documentElement?.localName?.toLowerCase();
  let parsed: GeoJSON.FeatureCollection<GeoJSON.Geometry | null>;
  if (root === "gpx") parsed = gpx(doc);
  else if (root === "kml") parsed = kml(doc);
  else throw new Error("Unrecognised track format (expected GPX or KML)");

  // Drop features without geometry (e.g. metadata-only waypoints), then stamp
  // colour + canyonId so the map line layer can colour via ["get", "color"].
  const features = parsed.features.filter(
    (feature): feature is GeoJSON.Feature<GeoJSON.Geometry> => feature.geometry != null,
  );
  for (const feature of features) {
    feature.properties = { ...(feature.properties ?? {}), color, canyonId };
  }
  return { type: "FeatureCollection", features };
}

export async function fetchTrackGeoJSON(
  displayUrl: string,
  color: string | null,
  canyonId: string,
): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(displayUrl);
  if (!res.ok) throw new Error(`Couldn't fetch track (${res.status})`);
  const xmlText = await res.text();
  return parseTrackGeoJSON(xmlText, color, canyonId);
}
