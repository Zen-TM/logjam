import { describe, expect, it } from "vitest";

import { trackPointsToGpx, trackPointsToKml } from "./trackExport.js";
import { parseGpx } from "./vectorImport.js";
import type { RecordedTrackPoint } from "./trackStats.js";

function point(overrides: Partial<RecordedTrackPoint> = {}): RecordedTrackPoint {
  return {
    lon: 150.123456,
    lat: -33.654321,
    altitudeM: 812.4,
    accuracyM: 5,
    timestampMs: Date.parse("2026-03-15T01:02:03.000Z"),
    segment: 0,
    ...overrides,
  };
}

describe("trackPointsToGpx", () => {
  it("writes a well-formed GPX 1.1 document", () => {
    const gpx = trackPointsToGpx("Claustral", [point()]);
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain("<name>Claustral</name>");
    expect(gpx).toContain('lat="-33.654321"');
    expect(gpx).toContain('lon="150.123456"');
    expect(gpx).toContain("<ele>812.4</ele>");
    expect(gpx).toContain("<time>2026-03-15T01:02:03.000Z</time>");
    expect(gpx.trimEnd().endsWith("</gpx>")).toBe(true);
  });

  it("splits segments so a pause is a gap, not a straight line", () => {
    const gpx = trackPointsToGpx("Two halves", [
      point({ segment: 0 }),
      point({ segment: 0, lat: -33.6 }),
      point({ segment: 1, lat: -33.5 }),
    ]);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
    const [first, second] = gpx.split("<trkseg>").slice(1);
    expect(first.match(/<trkpt/g)).toHaveLength(2);
    expect(second.match(/<trkpt/g)).toHaveLength(1);
  });

  it("omits <ele> for a fix with no altitude rather than writing 0", () => {
    const gpx = trackPointsToGpx("No alt", [point({ altitudeM: null })]);
    expect(gpx).not.toContain("<ele>");
    expect(gpx).toContain("<time>");
  });

  it("escapes XML metacharacters in the name", () => {
    const gpx = trackPointsToGpx('Bell & "Claustral" <fast>', [point()]);
    expect(gpx).toContain("<name>Bell &amp; &quot;Claustral&quot; &lt;fast&gt;</name>");
    expect(gpx).not.toContain('<name>Bell & "');
  });

  it("round-trips through the importer that reads GPX", () => {
    // The file we write must be one this codebase can read back — the writer
    // and the parser are the two halves of the same format.
    const gpx = trackPointsToGpx("Round trip", [
      point({ segment: 0, lat: -33.1, lon: 150.1 }),
      point({ segment: 0, lat: -33.2, lon: 150.2 }),
      point({ segment: 1, lat: -33.3, lon: 150.3 }),
    ]);
    const parsed = parseGpx(gpx);
    expect(parsed.features.length).toBeGreaterThan(0);
    const coordinates = JSON.stringify(parsed.features.map((f) => f.geometry));
    expect(coordinates).toContain("150.1");
    expect(coordinates).toContain("150.3");
  });
});

describe("trackPointsToKml", () => {
  it("writes one gx:Track with a when per coord", () => {
    const kml = trackPointsToKml("Claustral", [point(), point({ lon: 150.2 })]);
    expect(kml).toContain('xmlns:gx="http://www.google.com/kml/ext/2.2"');
    expect(kml).toContain("<gx:Track>");
    expect(kml).not.toContain("<gx:MultiTrack>");
    // gx:Track pairs the Nth <when> with the Nth <gx:coord> positionally, so
    // an uneven count silently misdates the whole track.
    expect(kml.match(/<when>/g)).toHaveLength(2);
    expect(kml.match(/<gx:coord>/g)).toHaveLength(2);
    expect(kml).toContain("<when>2026-03-15T01:02:03.000Z</when>");
  });

  it("writes gx:coord as space-separated lon lat alt", () => {
    const kml = trackPointsToKml("Order", [
      point({ lon: 150.5, lat: -33.5, altitudeM: 812.4 }),
    ]);
    expect(kml).toContain("<gx:coord>150.500000 -33.500000 812.4</gx:coord>");
  });

  it("omits altitude rather than writing 0 for a fix without one", () => {
    const kml = trackPointsToKml("No alt", [
      point({ lon: 150.5, lat: -33.5, altitudeM: null }),
    ]);
    expect(kml).toContain("<gx:coord>150.500000 -33.500000</gx:coord>");
  });

  it("splits segments into a non-interpolated MultiTrack", () => {
    const kml = trackPointsToKml("Paused", [
      point({ segment: 0 }),
      point({ segment: 1 }),
    ]);
    expect(kml).toContain("<gx:MultiTrack>");
    // 0 = do NOT draw a line across the pause gap.
    expect(kml).toContain("<gx:interpolate>0</gx:interpolate>");
    expect(kml.match(/<gx:Track>/g)).toHaveLength(2);
  });

  it("escapes the track name", () => {
    const kml = trackPointsToKml('Bell & "Claustral" <fast>', [point()]);
    expect(kml).toContain("<name>Bell &amp; &quot;Claustral&quot; &lt;fast&gt;</name>");
    expect(kml).not.toContain('<name>Bell & "');
  });
});
