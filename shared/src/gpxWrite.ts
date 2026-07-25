/**
 * GPX 1.1 serialisation for a recorded track.
 *
 * The counterpart to `vectorImport`'s GPX parsing: a track recorded in the app
 * is attached to a canyon or trip as a `application/gpx+xml` media item, which
 * is the shape both clients already understand (`TRACK_MIME_TYPES`) and which
 * the web renders on the map. Writing GPX rather than inventing a wire format
 * also means the file the user syncs is one they can open anywhere.
 *
 * PRIVACY: the output IS precise location history — the most sensitive data the
 * app holds. It travels only through the authed media upload, and callers must
 * never log it.
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
  const segments: RecordedTrackPoint[][] = [];
  for (const point of points) {
    const last = segments[segments.length - 1];
    if (!last || last[0].segment !== point.segment) segments.push([point]);
    else last.push(point);
  }

  const body = segments
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
