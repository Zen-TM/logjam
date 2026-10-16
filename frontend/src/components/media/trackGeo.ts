// Parse track files (GPX/KML/GeoJSON) into GeoJSON for the map track layers.
// Parsing happens client-side (the API never echoes track contents — privacy
// rule), so we fetch the presigned S3 URL directly with raw fetch (not
// apiFetch, whose base URL + auth are for our own API, not S3).
//
// One parser for both track sources: a place's attached track and a standalone
// file (the user's own import or a recorded GPS track) differ only in which id
// gets stamped on the features, so the caller passes that stamp rather than
// this file knowing about places.

import { gpx, kml } from "@tmcw/togeojson";

/** Extra feature properties the caller needs back out of the map layer —
 * `{ placeId }` for a place's track, `{ mediaId }` for a standalone file. */
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
      features: featuresOfGeoJson(
        json,
      ) as GeoJSON.Feature<GeoJSON.Geometry | null>[],
    };
  } else {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("Track file is not valid XML");
    }
    const root = doc.documentElement?.localName?.toLowerCase();
    if (root === "gpx") parsed = gpx(doc);
    else if (root === "kml") parsed = kml(doc);
    else
      throw new Error(
        "Unrecognised track format (expected GPX, KML or GeoJSON)",
      );
  }

  // Drop features without geometry (e.g. metadata-only waypoints), then stamp
  // colour + ids so the map line layer can colour via ["get", "color"].
  const features = parsed.features.filter(
    (feature): feature is GeoJSON.Feature<GeoJSON.Geometry> =>
      feature.geometry != null,
  );
  for (const feature of features) {
    feature.properties = { ...(feature.properties ?? {}), color, ...stamp };
  }
  return { type: "FeatureCollection", features };
}

/**
 * The cache key for one parsed track file on one map layer: id, stamp AND
 * colour. The colour is stamped into the features at parse time, so it has to
 * be part of the key or a recolour keeps drawing the old line.
 */
export function trackGeoCacheKey(entry: {
  mediaId: string;
  color: string | null;
  stamp: TrackFeatureStamp;
}): string {
  return `${entry.mediaId}|${entry.color}|${JSON.stringify(entry.stamp)}`;
}

/** How many files' text to keep: the lines drawn on the map plus the page
 *  being read. A file past it is fetched again when next asked for. */
const MAX_TRACK_TEXTS = 60;

/** Insertion order is the eviction order. In memory only, gone with the tab:
 *  this is the user's location history and is never written down or logged. */
const trackTexts = new Map<string, Promise<string>>();

/**
 * A track file's text, downloaded once per tab however many readers want it:
 * the map draws the line and the way page charts it, and each presigned
 * download is counted against the egress meter.
 *
 * Keyed by media id, not URL: a row's bytes never change (a recording finished
 * again is a new row, `mobile/src/tracks/trackBackup.ts`) while its presigned
 * URL rotates on every listing. `displayUrl` is only called on a miss, so a
 * reader with no URL in hand mints one only when it has to. A failed download
 * is forgotten, so the next ask tries again.
 */
export function fetchTrackText(
  mediaId: string,
  displayUrl: () => string | Promise<string>,
): Promise<string> {
  const cached = trackTexts.get(mediaId);
  if (cached) return cached;
  const text = (async () => {
    const res = await fetch(await displayUrl());
    if (!res.ok) throw new Error(`Couldn't fetch track (${res.status})`);
    return res.text();
  })();
  trackTexts.set(mediaId, text);
  text.catch(() => {
    if (trackTexts.get(mediaId) === text) trackTexts.delete(mediaId);
  });
  while (trackTexts.size > MAX_TRACK_TEXTS) {
    trackTexts.delete(trackTexts.keys().next().value!);
  }
  return text;
}

/** Test seam: a tab reload is the only reset Logjam Web needs. */
export function clearTrackTexts(): void {
  trackTexts.clear();
}

export async function fetchTrackGeoJSON(
  mediaId: string,
  displayUrl: string,
  color: string | null,
  stamp: TrackFeatureStamp,
): Promise<GeoJSON.FeatureCollection> {
  return parseTrackGeoJSON(
    await fetchTrackText(mediaId, () => displayUrl),
    color,
    stamp,
  );
}
