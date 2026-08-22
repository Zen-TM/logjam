/**
 * GPX and KML serialisation for an AUTHORED route.
 *
 * Separate from gpxWrite.ts, which writes a recorded track, because the two are
 * different things in GPX itself: `<trk>` is where you went, `<rte>` is where
 * you intend to go. A drawn route has no timestamps, so writing it as a track
 * forces a lie — the previous web export stamped every point 1970-01-01, which
 * other apps read as a real (and very old) recording. `<rte>`/`<rtept>` says
 * exactly what a Logjam route is, and our own importer already maps `rte` to a
 * LineString, so the round trip holds.
 *
 * PRIVACY: the output IS the line through a canyon — the most sensitive shape
 * of data this app holds. It is written to a file the user chose or handed to
 * the share sheet; it never goes to the server, and callers must never log it.
 */
import type { RoutePoint } from "./routeValidation.js";

/** XML text escaping. Route names are user text and can contain & or <. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Six decimal places ≈ 0.1 m — past GPS precision, and keeps files small. */
function coord(value: number): string {
  return value.toFixed(6);
}

export const GPX_MIME_TYPE = "application/gpx+xml";
export const KML_MIME_TYPE = "application/vnd.google-earth.kml+xml";
/** Imports are stored as GeoJSON, so exporting one needs a third type here. */
export const GEOJSON_MIME_TYPE = "application/geo+json";

/** One `<rte>` of `<rtept>`s. No `<time>`: a drawn route never happened. */
export function routeToGpx(name: string, points: readonly RoutePoint[]): string {
  const escaped = escapeXml(name);
  const body = points
    .map(([lon, lat]) => `    <rtept lat="${coord(lat)}" lon="${coord(lon)}" />`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Logjam" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>${escaped}</name>
${body}
  </rte>
</gpx>
`;
}

/** Minimal KML document holding one LineString. */
export function routeToKml(name: string, points: readonly RoutePoint[]): string {
  const escaped = escapeXml(name);
  const coords = points.map(([lon, lat]) => `${coord(lon)},${coord(lat)}`).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escaped}</name>
    <Placemark>
      <name>${escaped}</name>
      <LineString><coordinates>${coords}</coordinates></LineString>
    </Placemark>
  </Document>
</kml>
`;
}

/**
 * A filename for a way or import export.
 *
 * Names are free text and reach a real filesystem here, so anything that could
 * change what a path MEANS — separators, traversal, control characters, a
 * leading dot — is replaced rather than escaped. An empty result falls back to
 * `fallback`: a file called ".gpx" is hidden on Unix and rejected on Android.
 */
export function exportFilename(
  name: string,
  extension: "gpx" | "kml" | "geojson" | "pdf",
  fallback = "route",
): string {
  const safe = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80);
  return `${safe || fallback}.${extension}`;
}
