/**
 * GPX 1.1 and KML 2.2 serialisation for a RECORDED track.
 *
 * The counterpart to `vectorImport`'s GPX parsing: a track recorded in the app
 * is attached to a canyon or trip as a `application/gpx+xml` media item, which
 * is the shape both clients already understand (`TRACK_MIME_TYPES`) and which
 * the web renders on the map. Writing GPX rather than inventing a wire format
 * also means the file the user syncs is one they can open anywhere.
 *
 * Kept apart from routeExport.ts, which writes an AUTHORED route, because the
 * two are different things in both formats: a recording has timestamps and
 * pause gaps to preserve (`<trkseg>`, `<gx:Track>`), a drawn route has neither
 * and writing it as a track would stamp times that never happened.
 *
 * PRIVACY: the output IS precise location history — the most sensitive data the
 * app holds. It travels only through the authed media upload or into a file the
 * user picked a folder for, and callers must never log it.
 */
import type { RecordedTrackPoint } from "./trackStats.js";

/** XML text escaping. Track names are user text and can contain & or <. */
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

/**
 * Group consecutive points by `segment`, so a pause becomes a break rather
 * than a straight line across the gap. Points arrive ordered by time, so a
 * change of segment is a new run — no sorting or grouping by value.
 */
function splitBySegment(points: RecordedTrackPoint[]): RecordedTrackPoint[][] {
  const segments: RecordedTrackPoint[][] = [];
  for (const point of points) {
    const last = segments[segments.length - 1];
    if (!last || last[0].segment !== point.segment) segments.push([point]);
    else last.push(point);
  }
  return segments;
}

/**
 * One `<trk>` with a `<trkseg>` per recorded segment, so a pause shows as a gap
 * rather than a straight line across the break — the same reason the map
 * polyline is split by `segment`.
 *
 * Points are emitted in the order given; the caller supplies them ordered by
 * time. Returns a complete GPX document.
 */
export function trackPointsToGpx(
  name: string,
  points: RecordedTrackPoint[],
): string {
  const body = splitBySegment(points)
    .map((segment) => {
      const trkpts = segment
        .map((point) => {
          // A fix without altitude omits <ele> rather than writing 0 — GPX has
          // no "unknown elevation" value, and 0 would read as sea level.
          const elements = [
            ...(point.altitudeM == null
              ? []
              : [`        <ele>${point.altitudeM.toFixed(1)}</ele>`]),
            `        <time>${new Date(point.timestampMs).toISOString()}</time>`,
          ];
          return [
            `      <trkpt lat="${coord(point.lat)}" lon="${coord(point.lon)}">`,
            ...elements,
            `      </trkpt>`,
          ].join("\n");
        })
        .join("\n");
      return `    <trkseg>\n${trkpts}\n    </trkseg>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Logjam" xmlns="http://www.topografix.com/GPX/1/1">',
    "  <trk>",
    `    <name>${escapeXml(name)}</name>`,
    body,
    "  </trk>",
    "</gpx>",
    "",
  ].join("\n");
}

/**
 * One `<gx:Track>` per recorded segment.
 *
 * `gx:Track` rather than a plain `<LineString>` because a recording IS its
 * timestamps: the whens are what let Google Earth and Gaia play the walk back
 * and read a speed from it, and a LineString throws that away for a shape we
 * already export better as GPX. The extension namespace is the price — this is
 * the only way KML carries per-vertex time.
 *
 * Two or more segments become a `gx:MultiTrack` with `<gx:interpolate>0</…>`,
 * which is precisely "these are one track, do NOT join them across the gap".
 * A single segment is emitted bare, since a MultiTrack of one is noise readers
 * handle inconsistently.
 *
 * No `<altitudeMode>`, so the KML default (clampToGround) applies: altitude is
 * recorded in the file where a fix had one, but nothing renders the noisy GPS
 * vertical as if it were surveyed height.
 */
export function trackPointsToKml(
  name: string,
  points: RecordedTrackPoint[],
): string {
  const escaped = escapeXml(name);
  const segments = splitBySegment(points);

  const tracks = segments
    .map((segment) => {
      const whens = segment
        .map(
          (point) =>
            `        <when>${new Date(point.timestampMs).toISOString()}</when>`,
        )
        .join("\n");
      // gx:coord is SPACE-separated (unlike every other KML coordinate list,
      // which is comma-separated) and takes lon lat alt. A fix without altitude
      // emits two components rather than a zero, for the same reason <ele> is
      // omitted above: 0 would read as sea level.
      const coords = segment
        .map((point) => {
          const parts = [coord(point.lon), coord(point.lat)];
          if (point.altitudeM != null) parts.push(point.altitudeM.toFixed(1));
          return `        <gx:coord>${parts.join(" ")}</gx:coord>`;
        })
        .join("\n");
      return ["      <gx:Track>", whens, coords, "      </gx:Track>"].join("\n");
    })
    .join("\n");

  const geometry =
    segments.length > 1
      ? [
          "      <gx:MultiTrack>",
          "        <gx:interpolate>0</gx:interpolate>",
          tracks,
          "      </gx:MultiTrack>",
        ].join("\n")
      : tracks;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
    "  <Document>",
    `    <name>${escaped}</name>`,
    "    <Placemark>",
    `      <name>${escaped}</name>`,
    geometry,
    "    </Placemark>",
    "  </Document>",
    "</kml>",
    "",
  ].join("\n");
}
