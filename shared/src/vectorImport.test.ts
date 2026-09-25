import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  IMPORT_ERRORS,
  parseGeoJson,
  parseGpx,
  parseKml,
  parseVectorImport,
} from "./vectorImport";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

describe("parseGpx", () => {
  const result = parseGpx(fixture("sample-track.gpx"));

  it("maps wpt → Point, trkseg → LineString each, rte → LineString", () => {
    const types = result.features.map((f) => f.geometry.type);
    expect(types).toEqual([
      "Point",
      "LineString",
      "LineString",
      "LineString",
    ]);
    expect(result.stats).toEqual({
      points: 1,
      lines: 3,
      polygons: 0,
      positions: 8,
    });
  });

  it("carries names and elevations", () => {
    expect(result.features[0].properties.name).toBe("Car park");
    expect(result.features[1].properties.name).toBe("Track 20260101-000000");
    expect(result.features[3].properties.name).toBe("Exit route");
    // trkpt ele rides as the third coordinate; rtept without ele stays 2D.
    expect(result.features[1].geometry.coordinates).toEqual([
      [150.002, -33.002, 410],
      [150.0035, -33.003, 408],
      [150.004, -33.0045, 402],
    ]);
    expect(result.features[3].geometry.coordinates).toEqual([
      [150.008, -33.008],
      [150.01, -33.01],
    ]);
  });

  it("leaves coordTimes off a track whose points carry no <time>", () => {
    expect(result.features[1].properties.coordTimes).toBeUndefined();
  });

  it("carries per-vertex times, normalised to UTC, when every trkpt has one", () => {
    const timed = parseGpx(`<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Timed</name><trkseg>
    <trkpt lat="-33.002" lon="150.002"><time>2026-08-17T09:14:03+10:00</time></trkpt>
    <trkpt lat="-33.003" lon="150.003"><time>2026-08-17T09:15:03+10:00</time></trkpt>
  </trkseg></trk>
</gpx>`);
    expect(timed.features[0].properties.coordTimes).toEqual([
      "2026-08-16T23:14:03.000Z",
      "2026-08-16T23:15:03.000Z",
    ]);
  });

  it("drops the whole line's times when one trkpt is missing or unparseable", () => {
    // Part-timed is worse than untimed: a duration over the timed stretch and
    // a distance over all of it produce a speed belonging to neither.
    const partial = parseGpx(`<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="-33.002" lon="150.002"><time>2026-08-17T09:14:03Z</time></trkpt>
    <trkpt lat="-33.003" lon="150.003"/>
    <trkpt lat="-33.004" lon="150.004"><time>not a date</time></trkpt>
  </trkseg></trk>
</gpx>`);
    expect(partial.features[0].properties.coordTimes).toBeUndefined();
    // The geometry is untouched — an unusable clock is not an unusable track.
    expect(partial.features[0].geometry.coordinates).toHaveLength(3);
  });

  it("computes the bbox over every position", () => {
    expect(result.bbox).toEqual([150.001, -33.01, 150.01, -33.001]);
  });

  it("prefers the track name over a waypoint label for the document name", () => {
    expect(result.name).toBe("Track 20260101-000000");
  });

  it("rejects out-of-range coordinates with a static message", () => {
    const bad = fixture("sample-track.gpx").replace(
      'lat="-33.001000000"',
      'lat="-91.000000000"',
    );
    expect(() => parseGpx(bad)).toThrowError(IMPORT_ERRORS.invalidCoordinates);
  });

  it("rejects non-GPX XML", () => {
    expect(() => parseGpx("<html></html>")).toThrowError(
      IMPORT_ERRORS.unparseable,
    );
  });
});

describe("parseKml", () => {
  const result = parseKml(fixture("sample.kml"));

  it("collects Placemarks through Document/Folder nesting and MultiGeometry", () => {
    // NOTE: source sibling order is not preserved (XML → object grouping is
    // per tag name — inherent to the parser); order is deterministic:
    // current node's placemarks (geometry-type grouped) before child folders.
    expect(
      result.features.map((f) => [f.geometry.type, f.properties.name]),
    ).toEqual([
      ["Point", "Camp area"],
      ["Polygon", "Camp area"],
      ["LineString", "Ridge line"],
      ["Point", "Lookout"],
    ]);
    expect(result.name).toBe("Sample walk via ridge");
  });

  it("parses coordinate tuples with and without altitude", () => {
    expect(result.features[2].geometry.coordinates).toEqual([
      [150.002, -33.002, 410],
      [150.0035, -33.003, 408],
      [150.004, -33.0045, 402],
    ]);
    expect(result.features[1].geometry.coordinates).toEqual([
      [
        [150.008, -33.008],
        [150.009, -33.008],
        [150.009, -33.009],
        [150.008, -33.009],
        [150.008, -33.008],
      ],
    ]);
  });

  it("rejects a KML with no mappable features", () => {
    expect(() =>
      parseKml(
        `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Empty</name></Document></kml>`,
      ),
    ).toThrowError(IMPORT_ERRORS.noFeatures);
  });
});

describe("parseGeoJson", () => {
  it("accepts a FeatureCollection and keeps only supported members", () => {
    const result = parseGeoJson(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [150.5, -33.5] },
            properties: { name: "A", extraneous: "dropped" },
          },
          {
            type: "Feature",
            geometry: {
              type: "MultiLineString",
              coordinates: [
                [
                  [150.1, -33.1],
                  [150.2, -33.2],
                ],
              ],
            },
            properties: null,
          },
        ],
      }),
    );
    expect(result.stats).toEqual({
      points: 1,
      lines: 1,
      polygons: 0,
      positions: 3,
    });
    expect(result.features[0].properties).toEqual({ name: "A" });
  });

  it("accepts a bare geometry", () => {
    const result = parseGeoJson(
      JSON.stringify({ type: "LineString", coordinates: [[150, -33], [151, -34]] }),
    );
    expect(result.features).toHaveLength(1);
    expect(result.bbox).toEqual([150, -34, 151, -33]);
  });

  it("rejects lat/lon swapped out-of-range positions", () => {
    expect(() =>
      parseGeoJson(
        JSON.stringify({ type: "Point", coordinates: [-33.5, 150.5] }),
      ),
    ).toThrowError(IMPORT_ERRORS.invalidCoordinates);
  });

  it("rejects non-GeoJSON JSON and non-JSON text", () => {
    expect(() => parseGeoJson('{"hello":1}')).toThrowError(
      IMPORT_ERRORS.unparseable,
    );
    expect(() => parseGeoJson("not json")).toThrowError(
      IMPORT_ERRORS.unparseable,
    );
  });
});

describe("parseVectorImport dispatcher", () => {
  it("routes by extension, case-insensitively", () => {
    expect(
      parseVectorImport("Walk.GPX", fixture("sample-track.gpx")).stats.lines,
    ).toBe(3);
    expect(
      parseVectorImport("walk.kml", fixture("sample.kml")).name,
    ).toBe("Sample walk via ridge");
    expect(
      parseVectorImport(
        "area.geojson",
        JSON.stringify({ type: "Point", coordinates: [150, -33] }),
      ).stats.points,
    ).toBe(1);
  });

  it("rejects unknown extensions with a static message", () => {
    expect(() => parseVectorImport("track.fit", "")).toThrowError(
      IMPORT_ERRORS.unsupportedExtension,
    );
  });
});

// Every case here imported "successfully" before, with data missing or made
// up — the failure mode the root CLAUDE.md no-silent-fallbacks rule exists to
// prevent. A canyoner cannot tell a short track from a truncated one.
describe("malformed input fails loudly", () => {
  it("rejects a GPX truncated mid-download instead of importing a short track", () => {
    const truncated =
      '<gpx><trk><name>W</name><trkseg>' +
      '<trkpt lat="-33.00" lon="150.00"/><trkpt lat="-33.01" lon="150.01"/>';
    expect(() => parseGpx(truncated)).toThrow(IMPORT_ERRORS.unparseable);
  });

  it("rejects crossed close tags and trailing garbage", () => {
    expect(() =>
      parseGpx('<gpx><trk><trkseg><trkpt lat="-33" lon="150"/></trk></trkseg></gpx>'),
    ).toThrow(IMPORT_ERRORS.unparseable);
    expect(() =>
      parseGpx('<gpx><wpt lat="-33" lon="150"/></gpx>JUNK'),
    ).toThrow(IMPORT_ERRORS.unparseable);
  });

  it("rejects a KML whose geometry element carries no coordinates", () => {
    const kml =
      "<kml><Document>" +
      "<Placemark><Point><coordinates>150.0,-33.0</coordinates></Point></Placemark>" +
      "<Placemark><LineString><coordinates>   </coordinates></LineString></Placemark>" +
      "</Document></kml>";
    expect(() => parseKml(kml)).toThrow(IMPORT_ERRORS.invalidCoordinates);
  });

  it("does not invent a sea-level altitude from a trailing comma", () => {
    const kml =
      "<kml><Document><Placemark><Point>" +
      "<coordinates>150.0,-33.0,</coordinates>" +
      "</Point></Placemark></Document></kml>";
    expect(() => parseKml(kml)).toThrow(IMPORT_ERRORS.invalidCoordinates);
  });

  it("reports structurally bad GeoJSON coordinates as an import error", () => {
    // These escaped as a raw "position is not iterable" TypeError.
    for (const geometry of [
      '{"type":"LineString","coordinates":[150.1,-33.1]}',
      '{"type":"Polygon","coordinates":[150.1,-33.1]}',
      '{"type":"Point"}',
    ]) {
      expect(() => parseGeoJson(geometry)).toThrow(
        IMPORT_ERRORS.invalidCoordinates,
      );
    }
  });
});
